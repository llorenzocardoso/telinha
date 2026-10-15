// Opens the sender's viewer page in Chrome and prints receiver-side stats in the same layout as
// baseline/baseline.mjs. usage: node viewer.mjs [seconds=20] [port=8099]
import { chromium } from "../../../node_modules/playwright-core/index.mjs";

const [seconds = "20", port = "8099"] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-position=2000,100",
    "--window-size=500,300",
  ],
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForTimeout(Number(seconds) * 1000);
const { samples, error } = await page.evaluate(() => ({
  samples: window.__samples,
  error: window.__error,
}));
await browser.close();

if (error) console.log("viewer error:", error);
samples.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(2)}s recv ${String(r.decoded).padStart(3)} fps ${r.recvMbps.toFixed(2).padStart(6)} Mbps ${r.res} ` +
      `dropped=${r.dropped} freeze=${r.freezes} lost=${r.lost} nack=${r.nack} pli=${r.pli} rtt=${r.rttMs?.toFixed(1)}ms dec=${r.decoder}`,
  ),
);
const avg = (k) => samples.reduce((s, r) => s + (Number(r[k]) || 0), 0) / Math.max(1, samples.length);
console.log(
  `\nNATIVE ${samples.length}s: avg ${avg("decoded").toFixed(1)} fps, ${avg("recvMbps").toFixed(2)} Mbps, ` +
    `dropped ${samples.at(-1)?.dropped}, freezes ${samples.at(-1)?.freezes}, lost ${samples.at(-1)?.lost}`,
);
