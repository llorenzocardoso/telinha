//! Reusable capture -> NV12 -> hardware H.264 pipeline (WGC + D3D11 video processor + Media Foundation).

    use anyhow::{anyhow, Context, Result};
    use std::collections::{HashMap, VecDeque};
    use std::io::Write;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
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
    use windows::Win32::Foundation::{HMODULE, HWND, LPARAM, POINT, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsIconic, IsWindowVisible};
    use windows::Win32::Graphics::Direct3D::*;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1,
    };
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::Foundation::VARIANT_BOOL;
    use windows::Win32::System::Variant::{VARIANT, VARIANT_0_0, VT_BOOL, VT_UI4};
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
    use windows::Win32::System::WinRT::Direct3D11::{
        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
    };
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

    const RING: usize = 4;
    static ARRIVED: AtomicU64 = AtomicU64::new(0);

    fn even(v: u32) -> u32 {
        v & !1
    }

    pub struct Options {
        pub max_h: u32,
        pub fps: u32,
        /// Initial CBR target, bits per second.
        pub bitrate: u32,
        /// `None` runs until `Control::stop`.
        pub seconds: Option<u64>,
        pub out_path: Option<String>,
        /// Print the per-second line like the bench.
        pub verbose: bool,
    }

    /// Shared, lock-free inputs for the running pipeline.
    #[derive(Default)]
    pub struct Control {
        pub stop: AtomicBool,
        /// 0 = no change pending; otherwise a new CBR target in bits per second.
        pub bitrate: AtomicU32,
        pub keyframe: AtomicBool,
    }

    pub struct Frame {
        pub data: Vec<u8>,
        pub key: bool,
        /// Capture callback -> encoded output, milliseconds.
        pub latency_ms: f64,
    }

    pub fn run(opts: Options, control: Arc<Control>, mut on_frame: impl FnMut(Frame)) -> Result<()> {
        let (max_h, fps, mbps_bits) = (opts.max_h, opts.fps, opts.bitrate);
        let seconds = opts.seconds;
        let out_path = opts.out_path.clone();
        let mbps = mbps_bits as f64 / 1e6;

        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            MFStartup(MF_VERSION, MFSTARTUP_FULL)?;
        }

        // --- D3D11 device -------------------------------------------------------------
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let (adapter, vendor) = pick_adapter()?;
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
            )?;
        }
        let device = device.context("no D3D11 device")?;
        let context = context.context("no D3D11 context")?;
        unsafe {
            let mt: ID3D11Multithread = device.cast()?;
            let _ = mt.SetMultithreadProtected(true);
        }
        let dxgi: IDXGIDevice = device.cast()?;
        let winrt_device: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()? };

        // --- capture item (primary monitor) -------------------------------------------
        let hmon = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        // SPIKE_WINDOW=<title substring> captures that window instead of the primary monitor.
        let item: GraphicsCaptureItem = match std::env::var("SPIKE_WINDOW") {
            Ok(needle) => {
                let (hwnd, title) = find_window(&needle.to_lowercase())
                    .with_context(|| format!("no visible window matching {needle:?}"))?;
                println!("capturing window {title:?}");
                unsafe { interop.CreateForWindow(hwnd)? }
            }
            Err(_) => unsafe { interop.CreateForMonitor(hmon)? },
        };
        let size = item.Size()?;
        let (src_w, src_h) = (size.Width as u32, size.Height as u32);
        let scale = (max_h as f64 / src_h as f64).min(1.0);
        let (dst_w, dst_h) = (
            even((src_w as f64 * scale).round() as u32),
            even((src_h as f64 * scale).round() as u32),
        );
        println!(
            "source {src_w}x{src_h} -> encode {dst_w}x{dst_h} @ {fps} fps, {mbps} Mbps CBR, {seconds:?} s"
        );

        // --- NV12 ring + video processor ----------------------------------------------
        let video_device: ID3D11VideoDevice = device.cast()?;
        let video_context: ID3D11VideoContext = context.cast()?;
        let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL { Numerator: fps, Denominator: 1 },
            InputWidth: src_w,
            InputHeight: src_h,
            OutputFrameRate: DXGI_RATIONAL { Numerator: fps, Denominator: 1 },
            OutputWidth: dst_w,
            OutputHeight: dst_h,
            Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        };
        let enumerator = unsafe { video_device.CreateVideoProcessorEnumerator(&content)? };
        let processor = unsafe { video_device.CreateVideoProcessor(&enumerator, 0)? };
        unsafe {
            // input: full-range RGB; output: BT.709, limited range (16-235).
            let input_cs = D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 };
            let output_cs = D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: (1 << 2) | (1 << 4) };
            video_context.VideoProcessorSetStreamColorSpace(&processor, 0, &input_cs);
            video_context.VideoProcessorSetOutputColorSpace(&processor, &output_cs);
        }

        let nv12_desc = D3D11_TEXTURE2D_DESC {
            Width: dst_w,
            Height: dst_h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut nv12: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)> = Vec::new();
        for _ in 0..RING {
            let mut tex: Option<ID3D11Texture2D> = None;
            unsafe { device.CreateTexture2D(&nv12_desc, None, Some(&mut tex))? };
            let tex = tex.context("nv12 texture")?;
            let view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                },
            };
            let mut view: Option<ID3D11VideoProcessorOutputView> = None;
            unsafe {
                video_device.CreateVideoProcessorOutputView(
                    &tex,
                    &enumerator,
                    &view_desc,
                    Some(&mut view),
                )?
            };
            nv12.push((tex, view.context("output view")?));
        }
        let nv12 = Arc::new(nv12);

        // --- Media Foundation hardware H.264 encoder ----------------------------------
        let (transform, codec) = create_hw_encoder(&device, vendor, dst_w, dst_h, fps, mbps_bits)?;
        let events: IMFMediaEventGenerator = transform.cast()?;

        // --- capture -> NV12 (in the FrameArrived callback) ---------------------------
        let stop = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicU64::new(0));
        let captured = Arc::new(AtomicU64::new(0));
        let (tx, rx) = sync_channel::<(usize, i64, Instant)>(RING - 1);
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            3,
            size,
        )?;
        let min_interval = (10_000_000f64 / fps as f64 * 0.92) as i64;
        let state = Mutex::new((0usize, i64::MIN, HashMap::<usize, ID3D11VideoProcessorInputView>::new()));
        {
            let (nv12, dropped, captured) = (nv12.clone(), dropped.clone(), captured.clone());
            let (video_device, video_context) = (video_device.clone(), video_context.clone());
            let (enumerator, processor) = (enumerator.clone(), processor.clone());
            pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(
                move |pool, _| {
                    let Some(pool) = pool.as_ref() else { return Ok(()) };
                    while let Ok(frame) = pool.TryGetNextFrame() {
                        ARRIVED.fetch_add(1, Ordering::Relaxed);
                        let t = frame.SystemRelativeTime()?.Duration;
                        let mut st = state.lock().unwrap();
                        if st.1 != i64::MIN && t - st.1 < min_interval {
                            continue; // decimate to the target fps
                        }
                        captured.fetch_add(1, Ordering::Relaxed);
                        let surface = frame.Surface()?;
                        let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
                        let tex: ID3D11Texture2D = unsafe { access.GetInterface()? };
                        let key = tex.as_raw() as usize;
                        if !st.2.contains_key(&key) {
                            let desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                                FourCC: 0,
                                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                                    Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 },
                                },
                            };
                            let mut view: Option<ID3D11VideoProcessorInputView> = None;
                            unsafe {
                                video_device.CreateVideoProcessorInputView(
                                    &tex,
                                    &enumerator,
                                    &desc,
                                    Some(&mut view),
                                )?
                            };
                            st.2.insert(key, view.unwrap());
                        }
                        let slot = st.0;
                        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
                            Enable: TRUE,
                            OutputIndex: 0,
                            InputFrameOrField: 0,
                            PastFrames: 0,
                            FutureFrames: 0,
                            ppPastSurfaces: std::ptr::null_mut(),
                            pInputSurface: std::mem::ManuallyDrop::new(Some(st.2[&key].clone())),
                            ppFutureSurfaces: std::ptr::null_mut(),
                            ppPastSurfacesRight: std::ptr::null_mut(),
                            pInputSurfaceRight: std::mem::ManuallyDrop::new(None),
                            ppFutureSurfacesRight: std::ptr::null_mut(),
                        };
                        let blt = unsafe {
                            video_context.VideoProcessorBlt(&processor, &nv12[slot].1, 0, &[stream])
                        };
                        if blt.is_err() {
                            continue;
                        }
                        match tx.try_send((slot, t, Instant::now())) {
                            Ok(()) => {
                                st.0 = (slot + 1) % RING;
                                st.1 = t;
                            }
                            Err(_) => {
                                dropped.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    Ok(())
                },
            ))?;
        }
        let session: GraphicsCaptureSession = pool.CreateCaptureSession(&item)?;
        let _ = session.SetIsBorderRequired(false);
        session.SetIsCursorCaptureEnabled(true)?;
        session.StartCapture()?;

        // --- encoder loop ---------------------------------------------------------------
        let mut out_file = match &out_path {
            Some(p) => Some(std::fs::File::create(p)?),
            None => None,
        };
        let begin = Instant::now();
        let mut need_input = 0u32;
        let mut inflight: VecDeque<Instant> = VecDeque::new();
        let (mut frames, mut bytes, mut keyframes) = (0u64, 0u64, 0u64);
        let (mut win_frames, mut win_bytes, mut win_lat_ms, mut last_report) =
            (0u64, 0u64, 0f64, Instant::now());
        let mut lat_all: Vec<f64> = Vec::new();
        let mut idle_spins = 0u64;
        let mut applied_bitrate = mbps_bits;
        while !control.stop.load(Ordering::Relaxed)
            && seconds.map_or(true, |s| begin.elapsed() < Duration::from_secs(s))
        {
            apply_control(&codec, &control, &mut applied_bitrate);
            let mut progressed = false;
            // drain encoder events
            loop {
                match unsafe { events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
                    Ok(ev) => {
                        progressed = true;
                        let ty = unsafe { ev.GetType()? };
                        if ty == METransformNeedInput.0 as u32 {
                            need_input += 1;
                        } else if ty == METransformHaveOutput.0 as u32 {
                            let mut out = [MFT_OUTPUT_DATA_BUFFER::default()];
                            let mut status = 0u32;
                            unsafe { transform.ProcessOutput(0, &mut out, &mut status)? };
                            let sample = unsafe { std::mem::ManuallyDrop::take(&mut out[0].pSample) };
                            let _ = unsafe { std::mem::ManuallyDrop::take(&mut out[0].pEvents) };
                            if let Some(sample) = sample {
                                let buf = unsafe { sample.ConvertToContiguousBuffer()? };
                                let (mut ptr, mut len) = (std::ptr::null_mut(), 0u32);
                                unsafe { buf.Lock(&mut ptr, None, Some(&mut len))? };
                                let payload =
                                    unsafe { std::slice::from_raw_parts(ptr, len as usize) }.to_vec();
                                if let Some(f) = out_file.as_mut() {
                                    f.write_all(&payload)?;
                                }
                                unsafe { buf.Unlock()? };
                                let key = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) == 1;
                                let lat = inflight
                                    .pop_front()
                                    .map(|t| t.elapsed().as_secs_f64() * 1000.0)
                                    .unwrap_or(0.0);
                                frames += 1;
                                bytes += len as u64;
                                keyframes += key as u64;
                                win_frames += 1;
                                win_bytes += len as u64;
                                win_lat_ms += lat;
                                lat_all.push(lat);
                                on_frame(Frame { data: payload, key, latency_ms: lat });
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            // feed input
            while need_input > 0 {
                match rx.try_recv() {
                    Ok((slot, t, arrived)) => {
                        let sample = unsafe { MFCreateSample()? };
                        let buffer = unsafe {
                            MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &nv12[slot].0, 0, false)?
                        };
                        unsafe {
                            let _ = buffer.SetCurrentLength(dst_w * dst_h * 3 / 2);
                            sample.AddBuffer(&buffer)?;
                            sample.SetSampleTime(t)?;
                            sample.SetSampleDuration(10_000_000 / fps as i64)?;
                            transform.ProcessInput(0, &sample, 0)?;
                        }
                        inflight.push_back(arrived);
                        need_input -= 1;
                        progressed = true;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                }
            }
            if last_report.elapsed() >= Duration::from_secs(1) {
                let secs = last_report.elapsed().as_secs_f64();
                if opts.verbose {
                    println!(
                    "{:5.1} fps  {:6.2} Mbps  lat {:5.1} ms  arrived {} captured {} dropped {}",
                    win_frames as f64 / secs,
                    win_bytes as f64 * 8.0 / secs / 1e6,
                    if win_frames > 0 { win_lat_ms / win_frames as f64 } else { 0.0 },
                    ARRIVED.load(Ordering::Relaxed),
                    captured.load(Ordering::Relaxed),
                    dropped.load(Ordering::Relaxed),
                    );
                }
                win_frames = 0;
                win_bytes = 0;
                win_lat_ms = 0.0;
                last_report = Instant::now();
            }
            if !progressed {
                idle_spins += 1;
                std::thread::sleep(Duration::from_micros(400));
            }
        }
        stop.store(true, Ordering::Relaxed);
        session.Close()?;
        pool.Close()?;
        let total = begin.elapsed().as_secs_f64();
        lat_all.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let pct = |p: f64| lat_all.get(((lat_all.len() as f64 - 1.0) * p) as usize).copied().unwrap_or(0.0);
        println!(
            "\nSUMMARY {frames} frames in {total:.1}s = {:.1} fps avg, {:.2} Mbps avg, {keyframes} IDR, \
             latency p50 {:.1} / p95 {:.1} / p99 {:.1} ms, dropped {}, idle spins {idle_spins}",
            frames as f64 / total,
            bytes as f64 * 8.0 / total / 1e6,
            pct(0.5),
            pct(0.95),
            pct(0.99),
            dropped.load(Ordering::Relaxed),
        );
        Ok(())
    }

    fn variant_u32(v: u32) -> VARIANT {
        let mut var: VARIANT = unsafe { std::mem::zeroed() };
        unsafe {
            let inner: &mut VARIANT_0_0 = &mut var.Anonymous.Anonymous;
            inner.vt = VT_UI4;
            inner.Anonymous.ulVal = v;
        }
        var
    }

    fn variant_bool(v: bool) -> VARIANT {
        let mut var: VARIANT = unsafe { std::mem::zeroed() };
        unsafe {
            let inner: &mut VARIANT_0_0 = &mut var.Anonymous.Anonymous;
            inner.vt = VT_BOOL;
            inner.Anonymous.boolVal = VARIANT_BOOL(if v { -1 } else { 0 });
        }
        var
    }

    /// Prefers NVIDIA, then AMD, then Intel (same ranking as src-tauri/src/gpu.rs).
    /// SPIKE_VENDOR=nvidia|amd|intel forces one.
    fn pick_adapter() -> Result<(IDXGIAdapter1, u32)> {
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
        let forced = std::env::var("SPIKE_VENDOR").ok();
        let mut best: Option<(u32, IDXGIAdapter1, u32)> = None;
        for i in 0.. {
            let Ok(adapter) = (unsafe { factory.EnumAdapters1(i) }) else { break };
            let desc = unsafe { adapter.GetDesc1()? };
            let name = String::from_utf16_lossy(&desc.Description)
                .trim_end_matches('\0')
                .to_string();
            let luid = ((desc.AdapterLuid.HighPart as u64) << 32) | desc.AdapterLuid.LowPart as u64;
            let (rank, tag) = match desc.VendorId {
                0x10DE => (3, "nvidia"),
                0x1002 => (2, "amd"),
                0x8086 => (1, "intel"),
                _ => (0, "other"),
            };
            println!("adapter {i}: {name} [{tag}] luid {luid:#x}");
            let rank = match &forced {
                Some(v) if v == tag => 100,
                Some(_) => 0,
                None => rank,
            };
            if rank > 0 && best.as_ref().map_or(true, |b| rank > b.0) {
                best = Some((rank, adapter, desc.VendorId));
            }
        }
        let (_, adapter, vendor) = best.context("no suitable GPU adapter")?;
        Ok((adapter, vendor))
    }

    fn create_hw_encoder(
        device: &ID3D11Device,
        vendor: u32,
        w: u32,
        h: u32,
        fps: u32,
        bitrate: u32,
    ) -> Result<(IMFTransform, Option<ICodecAPI>)> {
        unsafe {
            let info = MFT_REGISTER_TYPE_INFO {
                guidMajorType: MFMediaType_Video,
                guidSubtype: MFVideoFormat_H264,
            };
            let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
            let mut count = 0u32;
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                None,
                Some(&info),
                &mut activates,
                &mut count,
            )?;
            if count == 0 {
                return Err(anyhow!("no hardware H.264 encoder MFT"));
            }
            let list = std::slice::from_raw_parts(activates, count as usize);
            let mut chosen: Option<IMFActivate> = None;
            for a in list.iter().flatten() {
                let mut buf = [0u16; 128];
                let mut n = 0u32;
                let _ = a.GetString(&MFT_FRIENDLY_NAME_Attribute, &mut buf, Some(&mut n));
                let name = String::from_utf16_lossy(&buf[..n as usize]);
                let mut vbuf = [0u16; 32];
                let mut vn = 0u32;
                let _ = a.GetString(&MFT_ENUM_HARDWARE_VENDOR_ID_Attribute, &mut vbuf, Some(&mut vn));
                let mft_vendor = String::from_utf16_lossy(&vbuf[..vn as usize]);
                println!("  mft: {name} vendor '{mft_vendor}'");
                let want = format!("VEN_{vendor:04X}");
                if mft_vendor.eq_ignore_ascii_case(&want) && chosen.is_none() {
                    chosen = Some(a.clone());
                }
            }
            let activate = chosen.context("no hardware H.264 MFT on the capture adapter")?;
            let transform: IMFTransform = activate.ActivateObject()?;
            // The array owns one reference per activate; release them, then free it.
            for a in std::slice::from_raw_parts_mut(activates, count as usize) {
                std::ptr::drop_in_place(a);
            }
            CoTaskMemFree(Some(activates as *const _));

            let attrs = transform.GetAttributes()?;
            attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            attrs.SetUINT32(&MF_LOW_LATENCY, 1)?;

            let mut token = 0u32;
            let mut manager: Option<IMFDXGIDeviceManager> = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
            let manager = manager.context("dxgi manager")?;
            manager.ResetDevice(device, token)?;
            transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)?;

            let codec = transform.cast::<ICodecAPI>().ok();
            if let Some(codec) = &codec {
                let set =|guid: &windows::core::GUID, v: VARIANT, what: &str| {
                    if let Err(e) = codec.SetValue(guid, &v) {
                        println!("  codec api {what}: {e}");
                    }
                };
                set(&CODECAPI_AVEncCommonRateControlMode, variant_u32(eAVEncCommonRateControlMode_CBR.0 as u32), "CBR");
                set(&CODECAPI_AVEncCommonMeanBitRate, variant_u32(bitrate), "bitrate");
                set(&CODECAPI_AVEncMPVGOPSize, variant_u32(std::env::var("SPIKE_GOP").ok().and_then(|v| v.parse().ok()).unwrap_or(fps * 60)), "gop");
                set(&CODECAPI_AVEncMPVDefaultBPictureCount, variant_u32(0), "bframes");
                set(&CODECAPI_AVLowLatencyMode, variant_bool(true), "low latency");
            }


            let pack = |a: u32, b: u32| ((a as u64) << 32) | b as u64;
            let out_type = MFCreateMediaType()?;
            out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            out_type.SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h))?;
            out_type.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
            out_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
            out_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            out_type.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
            transform.SetOutputType(0, &out_type, 0)?;

            let mut set_input = false;
            for i in 0.. {
                let Ok(t) = transform.GetInputAvailableType(0, i) else { break };
                if t.GetGUID(&MF_MT_SUBTYPE)? == MFVideoFormat_NV12 {
                    t.SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h))?;
                    t.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
                    t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
                    t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
                    transform.SetInputType(0, &t, 0)?;
                    set_input = true;
                    break;
                }
            }
            if !set_input {
                return Err(anyhow!("encoder does not accept NV12"));
            }

            transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
            Ok((transform, codec))
        }
    }

    /// Applies pending runtime changes (new CBR target, forced IDR) from the control block.
    fn apply_control(codec: &Option<ICodecAPI>, control: &Control, applied_bitrate: &mut u32) {
        let Some(codec) = codec else { return };
        let wanted = control.bitrate.load(Ordering::Relaxed);
        if wanted != 0 && wanted != *applied_bitrate {
            let v = variant_u32(wanted);
            if unsafe { codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &v) }.is_ok() {
                *applied_bitrate = wanted;
            }
        }
        if control.keyframe.swap(false, Ordering::Relaxed) {
            let v = variant_u32(1);
            let _ = unsafe { codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &v) };
        }
    }

/// First visible, non-minimized top-level window whose title contains `needle` (lowercase).
fn find_window(needle: &str) -> Option<(HWND, String)> {
    struct Ctx {
        needle: String,
        found: Option<(HWND, String)>,
    }
    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
            return TRUE;
        }
        let mut buf = [0u16; 256];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n > 0 {
            let title = String::from_utf16_lossy(&buf[..n as usize]);
            if title.to_lowercase().contains(&ctx.needle) {
                ctx.found = Some((hwnd, title));
                return windows::core::BOOL(0);
            }
        }
        TRUE
    }
    let mut ctx = Ctx { needle: needle.to_string(), found: None };
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut ctx as *mut Ctx as isize)) };
    ctx.found
}
