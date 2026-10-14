// Decodes the dev recording (Annex B H.264 + sizes sidecar) with WebCodecs in Chrome and saves
// PNGs of chosen frames. usage: node decode_frames.mjs <file.h264> <outPrefix> [frame indexes...]
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import fs from "node:fs";

const [file, prefix, ...rest] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(`${file}.json`, "utf8"));
const bytes = fs.readFileSync(file);
const wanted = rest.map(Number);
const last = meta.sizes.length - 1;
const picks = wanted.length ? wanted : [0, Math.floor(last / 3), Math.floor((2 * last) / 3), last];

// profile / constraint / level straight from the first SPS
let i = 0;
while (!(bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1 && (bytes[i + 3] & 0x1f) === 7)) i++;
const hex = (n) => n.toString(16).padStart(2, "0");
const codec = `avc1.${hex(bytes[i + 4])}${hex(bytes[i + 5])}${hex(bytes[i + 6])}`;

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-position=2000,100"] });
const page = await browser.newPage();
await page.route("http://127.0.0.1:9998/", (r) => r.fulfill({ contentType: "text/html", body: "<canvas id=c></canvas>" }));
await page.goto("http://127.0.0.1:9998/");
const shots = await page.evaluate(
  async ({ b64, sizes, codec, width, height, picks }) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const canvas = document.getElementById("c");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const out = {};
    let decoded = 0;
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (picks.includes(decoded)) {
          ctx.drawImage(frame, 0, 0);
          out[decoded] = canvas.toDataURL("image/png");
        }
        decoded++;
        frame.close();
      },
      error: (e) => (out.error = String(e)),
    });
    decoder.configure({ codec, codedWidth: width, codedHeight: height, avc: { format: "annexb" } });
    let offset = 0;
    sizes.forEach((size, n) => {
      decoder.decode(
        new EncodedVideoChunk({ type: n === 0 ? "key" : "delta", timestamp: n * 33333, data: data.slice(offset, offset + size) }),
      );
      offset += size;
    });
    await decoder.flush();
    out.decoded = decoded;
    return out;
  },
  { b64: bytes.toString("base64"), sizes: meta.sizes, codec, width: meta.width, height: meta.height, picks },
);
await browser.close();
console.log(`codec ${codec} ${meta.width}x${meta.height}, decoded ${shots.decoded}/${meta.sizes.length}`, shots.error ?? "");
for (const n of picks) {
  if (!shots[n]) continue;
  const file = `${prefix}-${n}.png`;
  fs.writeFileSync(file, Buffer.from(shots[n].split(",")[1], "base64"));
  console.log("saved", file);
}
