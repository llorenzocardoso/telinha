// Phase 0 baseline: today's sender path (getDisplayMedia + Chromium WebRTC) over loopback.
// Mirrors src/media/displayShare.ts (options, contentHint) and src/room/peerManager.ts
// (H.264 preference, maintain-framerate, maxBitrate, priority high).
//
// usage: node baseline.mjs [height=1080] [fps=60] [mbps=10] [seconds=15] [codec=h264|vp8]
import { chromium } from "../../../node_modules/playwright-core/index.mjs";

const [height = "1080", fps = "60", mbps = "10", seconds = "15", codec = "h264"] =
  process.argv.slice(2);

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--auto-select-desktop-capture-source=Screen 1",
    "--use-fake-ui-for-media-stream",
    "--enable-features=AllowWgcWindowCapturer",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-position=2000,100",
    "--window-size=500,300",
  ],
});
const page = await browser.newPage();
// localhost is a secure context, so getDisplayMedia is available.
await page.route("http://127.0.0.1:9999/", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
);
await page.goto("http://127.0.0.1:9999/");

const result = await page.evaluate(
  async ({ height, fps, mbps, seconds, codec }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: fps },
        resizeMode: "none",
        height: { max: height },
      },
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
    sink.muted = true;
    sink.autoplay = true;
    document.body.appendChild(sink);
    b.ontrack = (e) => (sink.srcObject = e.streams[0] ?? new MediaStream([e.track]));

    const sender = a.addTrack(track, stream);
    const tr = a.getTransceivers()[0];
    const caps = RTCRtpSender.getCapabilities("video").codecs;
    const want = codec === "h264" ? "video/H264" : "video/VP8";
    const rank = (c) => (c.mimeType === want ? 0 : /rtx|red|ulpfec/i.test(c.mimeType) ? 20 : 10);
    tr.setCodecPreferences([...caps].sort((x, y) => rank(x) - rank(y)));

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

    const samples = [];
    let prev = null;
    for (let i = 0; i < seconds; i++) {
      await sleep(1000);
      const out = {};
      for (const pc of [a, b]) {
        (await pc.getStats()).forEach((r) => {
          if (r.type === "outbound-rtp" && r.kind === "video") out.o = r;
          if (r.type === "inbound-rtp" && r.kind === "video") out.i = r;
        });
      }
      if (prev && out.o && out.i) {
        samples.push({
          t: i,
          sendFps: out.o.framesPerSecond,
          encodedFps: out.o.framesEncoded - prev.o.framesEncoded,
          sendMbps: ((out.o.bytesSent - prev.o.bytesSent) * 8) / 1e6,
          res: `${out.o.frameWidth}x${out.o.frameHeight}`,
          limit: out.o.qualityLimitationReason,
          encoder: out.o.encoderImplementation,
          keyFrames: out.o.keyFramesEncoded,
          recvFps: out.i.framesPerSecond,
          decoded: out.i.framesDecoded - prev.i.framesDecoded,
          dropped: out.i.framesDropped,
          freezes: out.i.freezeCount,
          decoder: out.i.decoderImplementation,
          jitterMs: out.i.jitter * 1000,
        });
      }
      prev = out;
    }
    track.stop();
    a.close();
    b.close();
    return samples;
  },
  { height: Number(height), fps: Number(fps), mbps: Number(mbps), seconds: Number(seconds), codec },
);
await browser.close();

const avg = (k) => result.reduce((s, r) => s + (Number(r[k]) || 0), 0) / result.length;
for (const r of result) {
  console.log(
    `${String(r.t).padStart(2)}s send ${String(r.encodedFps).padStart(3)} fps ${r.sendMbps.toFixed(2).padStart(6)} Mbps ${r.res} ` +
      `limit=${r.limit} enc=${r.encoder} | recv ${String(r.decoded).padStart(3)} fps dropped=${r.dropped} freeze=${r.freezes} dec=${r.decoder}`,
  );
}
console.log(
  `\nBASELINE ${codec} ${height}p${fps} target ${mbps} Mbps: avg encoded ${avg("encodedFps").toFixed(1)} fps, ` +
    `${avg("sendMbps").toFixed(2)} Mbps, received ${avg("decoded").toFixed(1)} fps, ` +
    `dropped ${result.at(-1)?.dropped}, freezes ${result.at(-1)?.freezes}`,
);
