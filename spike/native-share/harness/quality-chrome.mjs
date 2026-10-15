// Picture quality of TODAY's sender: Chrome getDisplayMedia on the quality-card window, over
// loopback, with the app's own settings (H.264 preferred, maintain-framerate, "motion" hint,
// 10 Mbps cap). Prints PSNR/SSIM of the received frame against the reference the window wrote.
//
// usage: node quality-chrome.mjs [seconds=15] [mbps=10] [codec=h264]
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import { measureFrame } from "./metrics.mjs";

const [seconds = "15", mbps = "10", codec = "h264"] = process.argv.slice(2);
const refPath = `${process.env.TEMP}\\telinha-quality-ref.png`;
const reference = fs.readFileSync(refPath).toString("base64");

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--auto-select-desktop-capture-source=Janela de qualidade",
    "--enable-features=AllowWgcWindowCapturer",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-position=2000,100",
    "--window-size=500,300",
  ],
});
const page = await browser.newPage();
await page.route("http://127.0.0.1:9999/", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
);
await page.goto("http://127.0.0.1:9999/");

const run = await page.evaluate(
  async ({ seconds, mbps, codec }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 }, resizeMode: "none", height: { max: 1080 } },
      audio: false,
      selfBrowserSurface: "exclude",
    });
    const track = stream.getVideoTracks()[0];
    track.contentHint = "motion";
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
    const sink = document.createElement("video");
    sink.id = "sink";
    sink.muted = true;
    sink.autoplay = true;
    document.body.appendChild(sink);
    b.ontrack = (e) => (sink.srcObject = e.streams[0] ?? new MediaStream([e.track]));
    const sender = a.addTrack(track, stream);
    const transceiver = a.getTransceivers()[0];
    const want = codec === "h264" ? "video/H264" : "video/VP8";
    const rank = (c) => (c.mimeType === want ? 0 : /rtx|red|ulpfec/i.test(c.mimeType) ? 20 : 10);
    transceiver.setCodecPreferences([...RTCRtpSender.getCapabilities("video").codecs].sort((x, y) => rank(x) - rank(y)));
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    const params = sender.getParameters();
    params.degradationPreference = "maintain-framerate";
    params.encodings[0].maxBitrate = mbps * 1_000_000;
    params.encodings[0].priority = "high";
    params.encodings[0].networkPriority = "high";
    await sender.setParameters(params);

    await sleep(seconds * 1000);
    let outbound;
    let inbound;
    (await a.getStats()).forEach((r) => r.type === "outbound-rtp" && r.kind === "video" && (outbound = r));
    (await b.getStats()).forEach((r) => r.type === "inbound-rtp" && r.kind === "video" && (inbound = r));
    window.__summary = {
      encoder: outbound?.encoderImplementation,
      limit: outbound?.qualityLimitationReason,
      sentSize: `${outbound?.frameWidth}x${outbound?.frameHeight}`,
      receivedSize: `${inbound?.frameWidth}x${inbound?.frameHeight}`,
      keyFrames: outbound?.keyFramesEncoded,
    };
    return window.__summary;
  },
  { seconds: Number(seconds), mbps: Number(mbps), codec },
);

const quality = await measureFrame(page, "video#sink", reference);
console.log(`QUALITY chrome ${codec}`, JSON.stringify({ ...run, ...quality }));
await browser.close();
