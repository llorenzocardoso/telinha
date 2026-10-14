// End-to-end check of the native share in the REAL app: the Tauri app (started with
// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 VITE_NATIVE_SHARE=1 npm run
// tauri dev`) shares a window through Rust + libwebrtc, and a headless Chrome viewer joins the same
// room through the local signaling server and watches.
//
// usage: node e2e-app.mjs <outPrefix> [closeWindowPid]
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [prefix = "e2e-app", closePid] = process.argv.slice(2);
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (message) => {
  console.log("FAIL:", message);
  process.exitCode = 1;
};

// ---- host: the real app, driven over the WebView2 debugging port ---------------------------
const appBrowser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const host = appBrowser.contexts()[0].pages()[0];
host.on("console", (m) => ["error", "warning"].includes(m.type()) && log("[app]", m.text().slice(0, 200)));
host.on("pageerror", (e) => log("[app pageerror]", String(e).slice(0, 200)));
await host.waitForLoadState("domcontentloaded");
log("app page:", host.url());

// The app restores the last room on start; the signaling server was restarted, so start clean.
await host.evaluate(() => localStorage.removeItem("telinha-active-session-v2"));
await host.reload();
await host.getByPlaceholder("Como você quer aparecer").fill("Anfitriao");
await host.evaluate(() => localStorage.setItem("telinha-share-audio", "1"));
await host.getByRole("button", { name: "Criar sala" }).click();
await host.getByTestId("room-code").waitFor();
const code = (await host.getByTestId("room-code").textContent())?.trim();
log("room", code);

// ---- viewer: headless Chrome ----------------------------------------------------------------
const chrome = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
});
const viewer = await (await chrome.newContext()).newPage();
viewer.on("pageerror", (e) => log("[viewer pageerror]", String(e).slice(0, 200)));
await viewer.goto("http://localhost:1420/");
await viewer.getByPlaceholder("Como você quer aparecer").fill("Espectador");
await viewer.getByRole("textbox", { name: "Código ou link do convite" }).fill(code);
await viewer.getByRole("button", { name: "Entrar na sala" }).click();
await viewer.getByRole("button", { name: "Sair da sala" }).waitFor();
log("viewer in the room");

// A second viewer, in its own context, to exercise one encoder serving two connections.
const viewer2 = await (await chrome.newContext()).newPage();
viewer2.on("pageerror", (e) => log("[viewer2 pageerror]", String(e).slice(0, 200)));
await viewer2.goto("http://localhost:1420/");
await viewer2.getByPlaceholder("Como você quer aparecer").fill("Espectador2");
await viewer2.getByRole("textbox", { name: "Código ou link do convite" }).fill(code);
await viewer2.getByRole("button", { name: "Entrar na sala" }).click();
await viewer2.getByRole("button", { name: "Sair da sala" }).waitFor();
log("second viewer in the room");

// ---- host: share the test window through the in-app picker ------------------------------------
await host.getByRole("button", { name: /Compartilhar tela/ }).click();
await host.getByText("O que compartilhar").waitFor({ timeout: 15000 });
await host.getByRole("radio", { name: /^Janelas/ }).click();
const card = host.getByRole("button", { name: /Janela de teste do envio/ });
await card.waitFor({ timeout: 15000 });

// New in the picker: application icons, and no click-through overlays in the list.
try {
  await host.waitForFunction(() => document.querySelectorAll(".source-icon").length > 0, null, { timeout: 20000 });
  const icons = await host.locator(".source-icon").count();
  const names = await host.locator(".source-card .source-name").allTextContents();
  log(`picker: ${names.length} windows, ${icons} icons`);
  if (names.some((n) => /GeForce Overlay/i.test(n))) fail("a click-through overlay is listed");
} catch {
  fail("no application icon arrived in the picker");
}
await card.click();
const pickerShot = `${prefix}-picker.png`;
await host.screenshot({ path: pickerShot });
log("picker screenshot", pickerShot);
await host.getByRole("button", { name: "Compartilhar", exact: true }).click();
await host.getByRole("button", { name: /Parar transmissão|Parar minha transmissão/ }).waitFor({ timeout: 20000 });
log("host is live");

// The sharer sees a preview of their own live (a canvas stream the app builds locally).
const preview = host.locator("[data-testid='live-preview'] video");
try {
  await preview.waitFor({ timeout: 10000 });
  await host.waitForFunction(
    () => (document.querySelector("[data-testid='live-preview'] video")?.currentTime ?? 0) > 0,
    null,
    { timeout: 10000 },
  );
  log("own live preview is playing");
} catch {
  fail("the sharer has no live preview");
}

// ---- viewer: watch ------------------------------------------------------------------------------
const people = viewer.getByRole("button", { name: "Fixar a lista de pessoas na lateral" });
if (await people.count()) await people.click();
await viewer.getByRole("button", { name: "Assistir" }).first().click();
const video = viewer.locator("video").first();
await video.waitFor({ timeout: 15000 });

// The second viewer watches too; both must get frames from the one encoder.
const pin2 = viewer2.getByRole("button", { name: "Fixar a lista de pessoas na lateral" });
if (await pin2.count()) await pin2.click();
await viewer2.getByRole("button", { name: "Assistir" }).first().click();
const video2 = viewer2.locator("video").first();
await video2.waitFor({ timeout: 15000 });
const frames2 = async () =>
  video2.evaluate((el) => el.getVideoPlaybackQuality?.().totalVideoFrames ?? 0);
for (let i = 0; i < 40 && (await frames2()) < 10; i++) await sleep(500);
const before2 = await frames2();
await sleep(2000);
const after2 = await frames2();
log("second viewer frames", before2, "->", after2);
if (!(after2 - before2 > 20)) fail("the second viewer is not receiving video");

const sample = () =>
  video.evaluate((el) => {
    const q = el.getVideoPlaybackQuality?.();
    return {
      w: el.videoWidth,
      h: el.videoHeight,
      t: el.currentTime,
      ready: el.readyState,
      frames: q?.totalVideoFrames ?? 0,
      dropped: q?.droppedVideoFrames ?? 0,
    };
  });

let first;
for (let i = 0; i < 40; i++) {
  first = await sample();
  if (first.w > 0 && first.frames > 5) break;
  await sleep(500);
}
log("first frames", JSON.stringify(first));
if (!(first.w > 0 && first.frames > 5)) fail("the viewer never received video");

// ---- audio: the test window plays a soft tone while the flag file exists ---------------------------
const toneFlag = `${process.env.TEMP}\\telinha-testwin.tone`;
const audioLevel = (ms) =>
  viewer.evaluate(async (ms) => {
    const stream = document.querySelector("video").srcObject;
    const tracks = stream.getAudioTracks().length;
    const ctx = new AudioContext();
    await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    let peak = 0;
    let loudestHz = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      if (rms > peak) {
        peak = rms;
        analyser.getFloatFrequencyData(spectrum);
        let best = 0;
        for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[best]) best = i;
        loudestHz = Math.round((best * ctx.sampleRate) / analyser.fftSize);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await ctx.close();
    return { tracks, rms: +peak.toFixed(4), hz: loudestHz };
  }, ms);

try { fs.unlinkSync(toneFlag); } catch {}
const quiet = await audioLevel(1500);
fs.writeFileSync(toneFlag, "on");
await sleep(600);
const loud = await audioLevel(2500);
try { fs.unlinkSync(toneFlag); } catch {}
log("audio tracks:", loud.tracks, "| level without tone:", quiet.rms, "| with tone:", loud.rms, "| loudest frequency:", loud.hz, "Hz");
if (loud.tracks < 1) fail("the viewer received no audio track");
else if (!(loud.rms > 0.01 && loud.rms > quiet.rms * 5)) fail("the tone did not reach the viewer");

const hostStats = async () =>
  host.evaluate(() => window.__TAURI_INTERNALS__.invoke("native_share_stats")).catch((e) => String(e));
const t0 = await sample();
const started = Date.now();
const rows = [];
for (let i = 0; i < 12; i++) {
  await sleep(1000);
  const s = await sample();
  rows.push({ ...s, host: await hostStats() });
}
const last = rows[rows.length - 1];
const seconds = (Date.now() - started) / 1000;
log(`viewer ${last.w}x${last.h}: ${((last.frames - t0.frames) / seconds).toFixed(1)} fps, dropped ${last.dropped - t0.dropped}`);
log("sender stats", JSON.stringify(rows[rows.length - 1].host));
if (rows[rows.length - 1].host?.viewers !== 2) fail("the sender should be serving 2 viewers");
if (!(last.frames - t0.frames > 100)) fail("the video did not keep flowing");
await video.screenshot({ path: `${prefix}-viewer.png` });
log("viewer screenshot", `${prefix}-viewer.png`);

// ---- host: the shared window closes by itself -> the share must end ---------------------------
if (closePid) {
  execFileSync("taskkill", ["/PID", closePid, "/F"]);
  log("closed the shared window");
  try {
    await host.getByRole("button", { name: /Compartilhar tela/ }).waitFor({ timeout: 15000 });
    log("host went back to idle");
    const msg = await host.locator("[role=alert], .room-error, .error").first().textContent({ timeout: 2000 }).catch(() => "");
    log("host message:", JSON.stringify(msg));
  } catch {
    fail("the share did not end when its window closed");
  }
  await sleep(1500);
  const gone = await viewer.locator("video").count();
  log("viewer videos after the share ended:", gone);
}

await chrome.close();
await appBrowser.close();
log(process.exitCode ? "RESULT: FAIL" : "RESULT: OK");
