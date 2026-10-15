// Runs one scenario for one sender and prints a comparable summary.
//   node run.mjs baseline <scenario> [seconds=30] [mbps=10]   Chrome getDisplayMedia sender (today)
//   node run.mjs native   <scenario> [seconds=30] [port=8099]  Rust sender (start sender.exe first)
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import { SCENARIOS, startProxy } from "./impair.mjs";

const [mode = "baseline", scenarioName = "clean", seconds = "30", extra] = process.argv.slice(2);
const scenario = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`unknown scenario ${scenarioName}`);
const proxies = [];

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--auto-select-desktop-capture-source=Screen 1",
    "--use-fake-ui-for-media-stream",
    "--enable-features=AllowWgcWindowCapturer",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-position=2000,100",
    "--window-size=500,300",
  ],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));

// The page asks for a proxy for each remote UDP address it wants to reach through the bottleneck.
// baseline: the media flows client -> target (a -> b); native: target -> client (sender -> Chrome).
const mediaToTarget = mode === "baseline";
await page.exposeFunction("proxify", async (ip, port) => {
  const p = await startProxy({
    targetIp: ip,
    targetPort: port,
    toTarget: mediaToTarget ? scenario : { delayMs: scenario.delayMs ?? 0 },
    toClient: mediaToTarget ? { delayMs: scenario.delayMs ?? 0 } : scenario,
  });
  proxies.push(p);
  return p.port;
});

let samples;
if (mode === "native") {
  await page.goto(`http://127.0.0.1:${extra ?? 8099}/?proxy=1`);
  await page.waitForTimeout(Number(seconds) * 1000 + 2000);
  samples = await page.evaluate(() => ({ s: window.__samples, e: window.__error }));
} else {
  await page.route("http://127.0.0.1:9999/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
  );
  await page.goto("http://127.0.0.1:9999/");
  samples = await page.evaluate(runBaseline, {
    seconds: Number(seconds),
    mbps: Number(extra ?? 10),
  });
}
await browser.close();

if (samples.e) console.log("error:", samples.e);
const s = samples.s;
const sum = (k) => s.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const last = s.at(-1) ?? {};
const at1080 = s.filter((r) => r.res?.endsWith("x1080")).length;
const resSeconds = {};
s.forEach((r) => (resSeconds[r.res] = (resSeconds[r.res] ?? 0) + 1));
const px = proxies.map((p) => p.stats());
console.log(
  `\n${mode.toUpperCase()} / ${scenarioName} (${JSON.stringify(scenario)})\n` +
    `  fps avg ${(sum("decoded") / s.length).toFixed(1)}   recv ${(sum("recvMbps") / s.length).toFixed(2)} Mbps   ` +
    `1080p for ${at1080}/${s.length}s   res-seconds ${JSON.stringify(resSeconds)}\n` +
    `  freezes ${last.freezes} (${(last.freezeDur ?? 0).toFixed(2)} s)   dropped ${last.dropped}   ` +
    `packetsLost ${last.lost}   nack ${last.nack}   pli ${last.pli}\n` +
    `  fps per second: ${s.map((r) => r.decoded).join(" ")}\n` +
    `  proxy: ${JSON.stringify(px.map((p) => ({ up: p.toTarget, down: p.toClient })))}`,
);
proxies.forEach((p) => p.close());

// ---- runs in the page: today's sender over a proxied ICE path -------------------------------
async function runBaseline({ seconds, mbps }) {
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
  let proxied = false;
  // b's candidates reach a only through a proxy; a's candidates are withheld from b, which learns
  // a's address from the checks that arrive via the proxy (peer-reflexive).
  a.oniceconnectionstatechange = () => console.log("a ice", a.iceConnectionState);
  b.oniceconnectionstatechange = () => console.log("b ice", b.iceConnectionState);
  b.onicecandidate = async (e) => {
    const c = e.candidate;
    if (c) console.log("b cand", c.candidate);
    if (!c || proxied) return;
    const f = c.candidate.split(" ");
    if (f[2].toLowerCase() !== "udp" || f[4].includes(":") || f[7] !== "host") return;
    proxied = true;
    f[5] = String(await window.proxify(f[4], Number(f[5])));
    try {
      await a.addIceCandidate({ candidate: f.join(" "), sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
      console.log("added", f.join(" "));
    } catch (err) {
      console.log("addIceCandidate failed", String(err));
    }
  };
  const sink = document.createElement("video");
  sink.muted = true;
  sink.autoplay = true;
  document.body.appendChild(sink);
  b.ontrack = (e) => (sink.srcObject = e.streams[0] ?? new MediaStream([e.track]));
  const sender = a.addTrack(track, stream);
  const tr = a.getTransceivers()[0];
  const caps = RTCRtpSender.getCapabilities("video").codecs;
  const rank = (c) => (c.mimeType === "video/H264" ? 0 : /rtx|red|ulpfec/i.test(c.mimeType) ? 20 : 10);
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

  const out = [];
  let prev = null;
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const cur = {};
    (await b.getStats()).forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "video") cur.i = r;
    });
    if (cur.i && prev) {
      out.push({
        decoded: cur.i.framesDecoded - prev.framesDecoded,
        recvMbps: ((cur.i.bytesReceived - prev.bytesReceived) * 8) / 1e6,
        res: `${cur.i.frameWidth}x${cur.i.frameHeight}`,
        dropped: cur.i.framesDropped,
        freezes: cur.i.freezeCount,
        freezeDur: cur.i.totalFreezesDuration,
        lost: cur.i.packetsLost,
        nack: cur.i.nackCount,
        pli: cur.i.pliCount,
      });
    }
    if (cur.i) prev = cur.i;
  }
  track.stop();
  a.close();
  b.close();
  return { s: out, e: null };
}
