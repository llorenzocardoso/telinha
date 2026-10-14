//! Capture -> NV12 -> hardware H.264, all on the GPU.
//!
//! Windows Graphics Capture frames are converted (and letterboxed into a fixed encode size) by
//! the D3D11 video processor, then encoded by the hardware H.264 Media Foundation transform that
//! belongs to the same adapter. Encoded access units go to `on_frame`; nothing here touches the
//! network. The caller steers the encoder through [`Control`].

use super::geometry::{encode_size, letterbox, SourceId};
use std::collections::hash_map::Entry;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows::core::Interface;
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND, RECT, TRUE, VARIANT_BOOL};
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1,
};
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0_0, VT_BOOL, VT_UI4};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::IsWindow;

/// Capture textures live in a ring so the encoder can still read one while capture fills another.
const RING: usize = 8;
/// A static screen produces no capture frames; the last one is re-submitted at this interval so
/// the receiver keeps getting media (and loss recovery keeps working).
const KEEPALIVE: Duration = Duration::from_millis(500);

pub struct Options {
    pub source: SourceId,
    /// 0 = no limit.
    pub max_height: u32,
    pub fps: u32,
    /// Initial constant bitrate, bits per second.
    pub bitrate: u32,
}

/// Lock-free inputs for a running pipeline.
#[derive(Default)]
pub struct Control {
    pub stop: AtomicBool,
    /// 0 = nothing pending; otherwise the new constant bitrate in bits per second.
    pub bitrate: AtomicU32,
    pub keyframe: AtomicBool,
}

pub struct Frame {
    /// Annex B access unit.
    pub data: Vec<u8>,
    pub key: bool,
    /// Capture -> encoded, milliseconds.
    pub latency_ms: f64,
}

pub struct Started {
    /// Fixed size of every encoded frame.
    pub width: u32,
    pub height: u32,
    pub encoder: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum End {
    Stopped,
    /// The window was closed or the display went away.
    SourceClosed,
}

fn ctx<T, E: std::fmt::Display>(result: Result<T, E>, what: &str) -> Result<T, String> {
    result.map_err(|err| format!("{what}: {err}"))
}

fn some<T>(value: Option<T>, what: &str) -> Result<T, String> {
    value.ok_or_else(|| what.to_string())
}

/// COM on this thread plus Media Foundation for the whole process.
///
/// Media Foundation is started once and never shut down: its work queues and the hardware
/// encoder's async events can still be draining when a pipeline ends, and shutting the platform
/// down underneath them crashes the next pipeline started in the same process.
struct MfGuard;

impl MfGuard {
    fn new() -> Result<Self, String> {
        static STARTED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
        // S_FALSE (already initialised on this thread) is a success.
        ctx(
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok(),
            "COM",
        )?;
        STARTED
            .get_or_init(|| {
                ctx(
                    unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) },
                    "Media Foundation",
                )
            })
            .clone()?;
        Ok(Self)
    }
}

struct Gpu {
    vendor: u32,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
}

/// NVIDIA, then AMD, then Intel (same order as `gpu::gpu_encode_info`).
fn rank(vendor: u32) -> u8 {
    match vendor {
        0x10DE => 3,
        0x1002 => 2,
        0x8086 => 1,
        _ => 0,
    }
}

fn open_gpu() -> Result<Gpu, String> {
    let factory: IDXGIFactory1 = ctx(unsafe { CreateDXGIFactory1() }, "DXGI")?;
    let mut best: Option<(u8, IDXGIAdapter1, u32)> = None;
    for index in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let desc = ctx(unsafe { adapter.GetDesc1() }, "adaptador de vídeo")?;
        let score = rank(desc.VendorId);
        if score > 0 && best.as_ref().is_none_or(|b| score > b.0) {
            best = Some((score, adapter, desc.VendorId));
        }
    }
    let (_, adapter, vendor) = some(best, "Nenhuma GPU compatível encontrada")?;

    let mut device = None;
    let mut context = None;
    ctx(
        unsafe {
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        },
        "dispositivo D3D11",
    )?;
    let device: ID3D11Device = some(device, "dispositivo D3D11 ausente")?;
    let context = some(context, "contexto D3D11 ausente")?;
    // Capture callbacks and the encoder thread share the immediate context.
    if let Ok(multithread) = device.cast::<ID3D11Multithread>() {
        let _ = unsafe { multithread.SetMultithreadProtected(true) };
    }
    Ok(Gpu {
        vendor,
        device,
        context,
    })
}

fn variant_u32(value: u32) -> VARIANT {
    let mut variant: VARIANT = unsafe { std::mem::zeroed() };
    unsafe {
        let inner: &mut VARIANT_0_0 = &mut variant.Anonymous.Anonymous;
        inner.vt = VT_UI4;
        inner.Anonymous.ulVal = value;
    }
    variant
}

fn variant_bool(value: bool) -> VARIANT {
    let mut variant: VARIANT = unsafe { std::mem::zeroed() };
    unsafe {
        let inner: &mut VARIANT_0_0 = &mut variant.Anonymous.Anonymous;
        inner.vt = VT_BOOL;
        inner.Anonymous.boolVal = VARIANT_BOOL(if value { -1 } else { 0 });
    }
    variant
}

struct Encoder {
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec: Option<ICodecAPI>,
    name: String,
}

/// Opens the hardware H.264 encoder that belongs to the capture adapter.
fn open_encoder(
    gpu: &Gpu,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
) -> Result<Encoder, String> {
    unsafe {
        let info = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        ctx(
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                None,
                Some(&info),
                &mut activates,
                &mut count,
            ),
            "listando codificadores",
        )?;
        if count == 0 || activates.is_null() {
            return Err("Nenhum codificador H.264 por hardware".into());
        }

        // The first hardware MFT may belong to another GPU; match by vendor id.
        let wanted = format!("VEN_{:04X}", gpu.vendor);
        let mut chosen: Option<(IMFActivate, String)> = None;
        for activate in std::slice::from_raw_parts(activates, count as usize)
            .iter()
            .flatten()
        {
            let mut vendor_buf = [0u16; 32];
            let mut vendor_len = 0u32;
            let _ = activate.GetString(
                &MFT_ENUM_HARDWARE_VENDOR_ID_Attribute,
                &mut vendor_buf,
                Some(&mut vendor_len),
            );
            let vendor = String::from_utf16_lossy(&vendor_buf[..vendor_len as usize]);
            if chosen.is_none() && vendor.eq_ignore_ascii_case(&wanted) {
                let mut name_buf = [0u16; 128];
                let mut name_len = 0u32;
                let _ = activate.GetString(
                    &MFT_FRIENDLY_NAME_Attribute,
                    &mut name_buf,
                    Some(&mut name_len),
                );
                let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
                chosen = Some((activate.clone(), name));
            }
        }
        let (activate, name) = match chosen {
            Some(found) => found,
            None => {
                release_activates(activates, count);
                return Err("O codificador H.264 não é da GPU de captura".into());
            }
        };
        let transform: Result<IMFTransform, _> = activate.ActivateObject();
        release_activates(activates, count);
        let transform = ctx(transform, "abrindo o codificador")?;

        let attrs = ctx(transform.GetAttributes(), "atributos do codificador")?;
        ctx(
            attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1),
            "desbloqueando o codificador",
        )?;
        ctx(attrs.SetUINT32(&MF_LOW_LATENCY, 1), "baixa latência")?;

        let mut token = 0u32;
        let mut manager: Option<IMFDXGIDeviceManager> = None;
        ctx(
            MFCreateDXGIDeviceManager(&mut token, &mut manager),
            "gerenciador DXGI",
        )?;
        let manager = some(manager, "gerenciador DXGI ausente")?;
        ctx(manager.ResetDevice(&gpu.device, token), "gerenciador DXGI")?;
        ctx(
            transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize),
            "ligando o codificador à GPU",
        )?;

        // Rate control and GOP must be set before the media types; afterwards the encoder
        // ignores the GOP length and emits a full keyframe about once a second.
        let codec = transform.cast::<ICodecAPI>().ok();
        if let Some(codec) = &codec {
            let set = |guid: &windows::core::GUID, value: VARIANT| {
                let _ = codec.SetValue(guid, &value);
            };
            set(
                &CODECAPI_AVEncCommonRateControlMode,
                variant_u32(eAVEncCommonRateControlMode_CBR.0 as u32),
            );
            set(&CODECAPI_AVEncCommonMeanBitRate, variant_u32(bitrate));
            set(&CODECAPI_AVEncMPVGOPSize, variant_u32(fps.max(1) * 60));
            set(&CODECAPI_AVEncMPVDefaultBPictureCount, variant_u32(0));
            set(&CODECAPI_AVLowLatencyMode, variant_bool(true));
        }

        let pack = |a: u32, b: u32| (u64::from(a) << 32) | u64::from(b);
        let progressive = MFVideoInterlace_Progressive.0 as u32;
        let out_type = ctx(MFCreateMediaType(), "tipo de saída")?;
        out_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .and_then(|_| out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264))
            .and_then(|_| out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate))
            .and_then(|_| out_type.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height)))
            .and_then(|_| out_type.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)))
            .and_then(|_| out_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1)))
            .and_then(|_| out_type.SetUINT32(&MF_MT_INTERLACE_MODE, progressive))
            .and_then(|_| {
                out_type.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)
            })
            .map_err(|e| format!("tipo de saída: {e}"))?;
        ctx(
            transform.SetOutputType(0, &out_type, 0),
            "formato de saída H.264",
        )?;

        let mut input_set = false;
        for index in 0.. {
            let Ok(available) = transform.GetInputAvailableType(0, index) else {
                break;
            };
            if available.GetGUID(&MF_MT_SUBTYPE) == Ok(MFVideoFormat_NV12) {
                available
                    .SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))
                    .and_then(|_| available.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)))
                    .and_then(|_| available.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1)))
                    .and_then(|_| available.SetUINT32(&MF_MT_INTERLACE_MODE, progressive))
                    .map_err(|e| format!("tipo de entrada: {e}"))?;
                ctx(
                    transform.SetInputType(0, &available, 0),
                    "formato de entrada NV12",
                )?;
                input_set = true;
                break;
            }
        }
        if !input_set {
            return Err("O codificador não aceita NV12".into());
        }

        ctx(
            transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0),
            "iniciando o codificador",
        )?;
        ctx(
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0),
            "iniciando o codificador",
        )?;
        ctx(
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0),
            "iniciando o codificador",
        )?;
        let events: IMFMediaEventGenerator = ctx(transform.cast(), "eventos do codificador")?;
        Ok(Encoder {
            transform,
            events,
            codec,
            name,
        })
    }
}

/// Releases the activate array returned by `MFTEnumEx`.
unsafe fn release_activates(activates: *mut Option<IMFActivate>, count: u32) {
    for activate in std::slice::from_raw_parts_mut(activates, count as usize) {
        std::ptr::drop_in_place(activate);
    }
    CoTaskMemFree(Some(activates as *const _));
}

fn apply_control(encoder: &Encoder, control: &Control, applied_bitrate: &mut u32) {
    let Some(codec) = &encoder.codec else {
        return;
    };
    let wanted = control.bitrate.load(Ordering::Relaxed);
    if wanted != 0 && wanted != *applied_bitrate {
        let value = variant_u32(wanted);
        if unsafe { codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &value) }.is_ok() {
            *applied_bitrate = wanted;
        }
    }
    if control.keyframe.swap(false, Ordering::Relaxed) {
        let value = variant_u32(1);
        let _ = unsafe { codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &value) };
    }
}

pub struct EncoderProbe {
    pub vendor: String,
    pub name: String,
}

/// Whether capture + hardware encoding can run here, without capturing anything.
pub fn probe() -> Result<EncoderProbe, String> {
    let _mf = MfGuard::new()?;
    let gpu = open_gpu()?;
    let encoder = open_encoder(&gpu, 1280, 720, 30, 4_000_000)?;
    let vendor = match gpu.vendor {
        0x10DE => "nvidia",
        0x1002 => "amd",
        _ => "intel",
    };
    Ok(EncoderProbe {
        vendor: vendor.into(),
        name: encoder.name,
    })
}

fn create_item(source: SourceId) -> Result<GraphicsCaptureItem, String> {
    let interop = ctx(
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>(),
        "captura do Windows",
    )?;
    match source {
        SourceId::Screen(_) => {
            let monitor = HMONITOR(source.handle() as *mut _);
            ctx(
                unsafe { interop.CreateForMonitor(monitor) },
                "capturando a tela",
            )
        }
        SourceId::Window(_) => {
            let window = HWND(source.handle() as *mut _);
            if !unsafe { IsWindow(Some(window)) }.as_bool() {
                return Err("A janela não existe mais".into());
            }
            ctx(
                unsafe { interop.CreateForWindow(window) },
                "capturando a janela",
            )
        }
    }
}

/// The WinRT Direct3D device wrapper is free-threaded (WGC calls back on pool threads) but the
/// bindings do not mark it `Send`.
struct Agile<T>(T);

unsafe impl<T> Send for Agile<T> {}
unsafe impl<T> Sync for Agile<T> {}

impl<T> Agile<T> {
    fn get(&self) -> &T {
        &self.0
    }
}

struct CaptureState {
    next_slot: usize,
    last_time: Option<i64>,
    pool_size: SizeInt32,
    content: (u32, u32),
    views: HashMap<usize, ID3D11VideoProcessorInputView>,
}

struct Queued {
    slot: usize,
    arrived: Instant,
}

/// Runs until `control.stop` is set or the source closes. Blocks the calling thread.
pub fn run(
    opts: Options,
    control: Arc<Control>,
    on_started: impl FnOnce(Started),
    mut on_frame: impl FnMut(Frame),
) -> Result<End, String> {
    let fps = opts.fps.clamp(1, 120);
    let _mf = MfGuard::new()?;
    let gpu = open_gpu()?;
    let dxgi: IDXGIDevice = ctx(gpu.device.cast(), "DXGI")?;
    let winrt_device: IDirect3DDevice = ctx(
        unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.and_then(|d| d.cast()),
        "dispositivo de captura",
    )?;

    let item = create_item(opts.source)?;
    let size = ctx(item.Size(), "tamanho da fonte")?;
    let (src_w, src_h) = (size.Width.max(2) as u32, size.Height.max(2) as u32);
    let (dst_w, dst_h) = encode_size(src_w, src_h, opts.max_height);

    // --- video processor: BGRA (any size) -> letterboxed NV12 (fixed size) ---------------------
    let video_device: ID3D11VideoDevice = ctx(gpu.device.cast(), "vídeo D3D11")?;
    let video_context: ID3D11VideoContext = ctx(gpu.context.cast(), "vídeo D3D11")?;
    let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
        InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
        InputFrameRate: DXGI_RATIONAL {
            Numerator: fps,
            Denominator: 1,
        },
        InputWidth: src_w,
        InputHeight: src_h,
        OutputFrameRate: DXGI_RATIONAL {
            Numerator: fps,
            Denominator: 1,
        },
        OutputWidth: dst_w,
        OutputHeight: dst_h,
        Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    };
    let enumerator = ctx(
        unsafe { video_device.CreateVideoProcessorEnumerator(&content_desc) },
        "conversor de vídeo",
    )?;
    let processor = ctx(
        unsafe { video_device.CreateVideoProcessor(&enumerator, 0) },
        "conversor de vídeo",
    )?;
    unsafe {
        // Input: full-range RGB. Output: BT.709, limited range.
        let input_cs = D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 };
        let output_cs = D3D11_VIDEO_PROCESSOR_COLOR_SPACE {
            _bitfield: (1 << 2) | (1 << 4),
        };
        video_context.VideoProcessorSetStreamColorSpace(&processor, 0, &input_cs);
        video_context.VideoProcessorSetOutputColorSpace(&processor, &output_cs);
        let black = D3D11_VIDEO_COLOR {
            Anonymous: D3D11_VIDEO_COLOR_0 {
                RGBA: D3D11_VIDEO_COLOR_RGBA {
                    R: 0.0,
                    G: 0.0,
                    B: 0.0,
                    A: 1.0,
                },
            },
        };
        video_context.VideoProcessorSetOutputBackgroundColor(&processor, false, &black);
        let frame_rect = RECT {
            left: 0,
            top: 0,
            right: dst_w as i32,
            bottom: dst_h as i32,
        };
        video_context.VideoProcessorSetOutputTargetRect(&processor, true, Some(&frame_rect));
    }

    let nv12_desc = D3D11_TEXTURE2D_DESC {
        Width: dst_w,
        Height: dst_h,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_NV12,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut nv12: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)> = Vec::new();
    for _ in 0..RING {
        let mut texture = None;
        ctx(
            unsafe {
                gpu.device
                    .CreateTexture2D(&nv12_desc, None, Some(&mut texture))
            },
            "textura NV12",
        )?;
        let texture: ID3D11Texture2D = some(texture, "textura NV12 ausente")?;
        let view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };
        let mut view = None;
        ctx(
            unsafe {
                video_device.CreateVideoProcessorOutputView(
                    &texture,
                    &enumerator,
                    &view_desc,
                    Some(&mut view),
                )
            },
            "visão NV12",
        )?;
        nv12.push((texture, some(view, "visão NV12 ausente")?));
    }
    let nv12 = Arc::new(nv12);

    let encoder = open_encoder(&gpu, dst_w, dst_h, fps, opts.bitrate)?;
    on_started(Started {
        width: dst_w,
        height: dst_h,
        encoder: encoder.name.clone(),
    });

    // --- capture: every WGC frame is converted into a free NV12 slot --------------------------
    let closed = Arc::new(AtomicBool::new(false));
    let (tx, rx) = sync_channel::<Queued>(3);
    let pool = ctx(
        Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            3,
            size,
        ),
        "fila de captura",
    )?;
    let min_interval = (10_000_000f64 / f64::from(fps) * 0.92) as i64;
    let state = Mutex::new(CaptureState {
        next_slot: 0,
        last_time: None,
        pool_size: size,
        content: (src_w, src_h),
        views: HashMap::new(),
    });
    let frame_token = {
        let nv12 = nv12.clone();
        let (video_device, video_context) = (video_device.clone(), video_context.clone());
        let (enumerator, processor) = (enumerator.clone(), processor.clone());
        let winrt_device = Agile(winrt_device.clone());
        ctx(
            pool.FrameArrived(&TypedEventHandler::<
                Direct3D11CaptureFramePool,
                windows::core::IInspectable,
            >::new(move |pool, _| {
                let Some(pool) = pool.as_ref() else {
                    return Ok(());
                };
                while let Ok(frame) = pool.TryGetNextFrame() {
                    let time = frame.SystemRelativeTime()?.Duration;
                    let mut st = state.lock().unwrap();
                    if st.last_time.is_some_and(|last| time - last < min_interval) {
                        continue; // decimate to the target fps
                    }
                    let content = frame.ContentSize()?;
                    let (cw, ch) = (content.Width.max(2) as u32, content.Height.max(2) as u32);
                    if (cw, ch) != st.content {
                        st.content = (cw, ch);
                    }
                    let (x, y, w, h) = letterbox(cw, ch, dst_w, dst_h);
                    let surface = frame.Surface()?;
                    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
                    let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
                    let key = texture.as_raw() as usize;
                    let input = match st.views.entry(key) {
                        Entry::Occupied(entry) => entry.get().clone(),
                        Entry::Vacant(entry) => {
                            let desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                                FourCC: 0,
                                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                                    Texture2D: D3D11_TEX2D_VPIV {
                                        MipSlice: 0,
                                        ArraySlice: 0,
                                    },
                                },
                            };
                            let mut view = None;
                            unsafe {
                                video_device.CreateVideoProcessorInputView(
                                    &texture,
                                    &enumerator,
                                    &desc,
                                    Some(&mut view),
                                )?
                            };
                            let Some(view) = view else {
                                continue;
                            };
                            entry.insert(view).clone()
                        }
                    };
                    let source_rect = RECT {
                        left: 0,
                        top: 0,
                        right: cw as i32,
                        bottom: ch as i32,
                    };
                    let dest_rect = RECT {
                        left: x as i32,
                        top: y as i32,
                        right: (x + w) as i32,
                        bottom: (y + h) as i32,
                    };
                    let slot = st.next_slot;
                    let stream = D3D11_VIDEO_PROCESSOR_STREAM {
                        Enable: TRUE,
                        OutputIndex: 0,
                        InputFrameOrField: 0,
                        PastFrames: 0,
                        FutureFrames: 0,
                        ppPastSurfaces: std::ptr::null_mut(),
                        pInputSurface: std::mem::ManuallyDrop::new(Some(input)),
                        ppFutureSurfaces: std::ptr::null_mut(),
                        ppPastSurfacesRight: std::ptr::null_mut(),
                        pInputSurfaceRight: std::mem::ManuallyDrop::new(None),
                        ppFutureSurfacesRight: std::ptr::null_mut(),
                    };
                    let blt = unsafe {
                        video_context.VideoProcessorSetStreamSourceRect(
                            &processor,
                            0,
                            true,
                            Some(&source_rect),
                        );
                        video_context.VideoProcessorSetStreamDestRect(
                            &processor,
                            0,
                            true,
                            Some(&dest_rect),
                        );
                        video_context.VideoProcessorBlt(&processor, &nv12[slot].1, 0, &[stream])
                    };
                    if blt.is_ok()
                        && tx
                            .try_send(Queued {
                                slot,
                                arrived: Instant::now(),
                            })
                            .is_ok()
                    {
                        st.next_slot = (slot + 1) % RING;
                        st.last_time = Some(time);
                    }
                    // The pool's buffers follow the content; grow or shrink them after use.
                    if content.Width != st.pool_size.Width || content.Height != st.pool_size.Height
                    {
                        st.pool_size = content;
                        st.views.clear();
                        drop(frame);
                        let _ = pool.Recreate(
                            winrt_device.get(),
                            DirectXPixelFormat::B8G8R8A8UIntNormalized,
                            3,
                            content,
                        );
                        break;
                    }
                }
                Ok(())
            })),
            "eventos de captura",
        )?
    };
    let closed_token = {
        let closed = closed.clone();
        ctx(
            item.Closed(&TypedEventHandler::<
                GraphicsCaptureItem,
                windows::core::IInspectable,
            >::new(move |_, _| {
                closed.store(true, Ordering::Relaxed);
                Ok(())
            })),
            "eventos da fonte",
        )?
    };
    let session: GraphicsCaptureSession =
        ctx(pool.CreateCaptureSession(&item), "sessão de captura")?;
    // No yellow border where the OS allows it; the cursor is part of the share.
    let _ = session.SetIsBorderRequired(false);
    ctx(session.SetIsCursorCaptureEnabled(true), "cursor")?;
    ctx(session.StartCapture(), "iniciando a captura")?;

    // --- encoder loop ---------------------------------------------------------------------------
    let frame_duration = 10_000_000 / i64::from(fps);
    let mut need_input = 0u32;
    let mut inflight: VecDeque<Instant> = VecDeque::new();
    let mut applied_bitrate = opts.bitrate;
    let mut last_slot: Option<usize> = None;
    let mut last_input = Instant::now();
    let mut sample_time = 0i64;
    let mut last_alive_check = Instant::now();
    let mut result: Result<(), String> = Ok(());
    'run: while !control.stop.load(Ordering::Relaxed) && !closed.load(Ordering::Relaxed) {
        apply_control(&encoder, &control, &mut applied_bitrate);
        let mut progressed = false;

        // The Closed event is not always raised for windows; check the handle as well.
        if let SourceId::Window(_) = opts.source {
            if last_alive_check.elapsed() >= Duration::from_millis(250) {
                last_alive_check = Instant::now();
                let window = HWND(opts.source.handle() as *mut _);
                if !unsafe { IsWindow(Some(window)) }.as_bool() {
                    closed.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }

        // Drain encoder events: input requests and finished access units.
        while let Ok(event) = unsafe { encoder.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
            progressed = true;
            let kind = match unsafe { event.GetType() } {
                Ok(kind) => kind,
                Err(e) => {
                    result = Err(format!("evento do codificador: {e}"));
                    break 'run;
                }
            };
            if kind == METransformNeedInput.0 as u32 {
                need_input += 1;
            } else if kind == METransformHaveOutput.0 as u32 {
                match read_output(&encoder.transform) {
                    Ok(Some((data, key))) => {
                        let latency_ms = inflight
                            .pop_front()
                            .map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0);
                        on_frame(Frame {
                            data,
                            key,
                            latency_ms,
                        });
                    }
                    Ok(None) => {}
                    Err(e) => {
                        result = Err(e);
                        break 'run;
                    }
                }
            }
        }

        // Feed input: a fresh frame when capture produced one, else repeat the last on a timer.
        while need_input > 0 {
            let (slot, arrived) = match rx.try_recv() {
                Ok(queued) => (queued.slot, queued.arrived),
                Err(TryRecvError::Empty) => match last_slot {
                    Some(slot) if last_input.elapsed() >= KEEPALIVE => (slot, Instant::now()),
                    _ => break,
                },
                Err(TryRecvError::Disconnected) => break,
            };
            if let Err(e) = submit(
                &encoder.transform,
                &nv12[slot].0,
                sample_time,
                frame_duration,
                dst_w,
                dst_h,
            ) {
                result = Err(e);
                break 'run;
            }
            sample_time += frame_duration;
            inflight.push_back(arrived);
            need_input -= 1;
            last_slot = Some(slot);
            last_input = Instant::now();
            progressed = true;
        }

        if !progressed {
            std::thread::sleep(Duration::from_micros(400));
        }
    }

    // --- shutdown -------------------------------------------------------------------------------
    let _ = pool.RemoveFrameArrived(frame_token);
    let _ = item.RemoveClosed(closed_token);
    let _ = session.Close();
    let _ = pool.Close();
    let _ = unsafe {
        encoder
            .transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)
    };
    let _ = unsafe {
        encoder
            .transform
            .ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)
    };
    result?;
    Ok(if closed.load(Ordering::Relaxed) {
        End::SourceClosed
    } else {
        End::Stopped
    })
}

fn submit(
    transform: &IMFTransform,
    texture: &ID3D11Texture2D,
    time: i64,
    duration: i64,
    width: u32,
    height: u32,
) -> Result<(), String> {
    unsafe {
        let sample = ctx(MFCreateSample(), "amostra")?;
        let buffer = ctx(
            MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, texture, 0, false),
            "buffer de vídeo",
        )?;
        let _ = buffer.SetCurrentLength(width * height * 3 / 2);
        ctx(sample.AddBuffer(&buffer), "amostra")?;
        ctx(sample.SetSampleTime(time), "amostra")?;
        ctx(sample.SetSampleDuration(duration), "amostra")?;
        ctx(
            transform.ProcessInput(0, &sample, 0),
            "enviando quadro ao codificador",
        )
    }
}

/// Reads one encoded access unit; `None` when the encoder had nothing to hand over.
fn read_output(transform: &IMFTransform) -> Result<Option<(Vec<u8>, bool)>, String> {
    unsafe {
        let mut out = [MFT_OUTPUT_DATA_BUFFER::default()];
        let mut status = 0u32;
        ctx(
            transform.ProcessOutput(0, &mut out, &mut status),
            "lendo o quadro codificado",
        )?;
        let sample = std::mem::ManuallyDrop::take(&mut out[0].pSample);
        let _ = std::mem::ManuallyDrop::take(&mut out[0].pEvents);
        let Some(sample) = sample else {
            return Ok(None);
        };
        let buffer = ctx(sample.ConvertToContiguousBuffer(), "quadro codificado")?;
        let (mut data_ptr, mut len) = (std::ptr::null_mut(), 0u32);
        ctx(
            buffer.Lock(&mut data_ptr, None, Some(&mut len)),
            "quadro codificado",
        )?;
        let data = std::slice::from_raw_parts(data_ptr, len as usize).to_vec();
        let _ = buffer.Unlock();
        let key = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) == 1;
        Ok(Some((data, key)))
    }
}
