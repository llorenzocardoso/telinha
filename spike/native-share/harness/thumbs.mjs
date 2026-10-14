// Opens the in-app picker in the running dev app and reports, per source, whether its thumbnail
// arrived and whether it is actually an image (mean brightness), without saving any pixels.
import { chromium } from "../../../node_modules/playwright-core/index.mjs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
await page.getByRole("button", { name: /Compartilhar tela/ }).click();
await page.getByText("O que compartilhar").waitFor({ timeout: 15000 });

for (const tab of [/^Telas/, /^Janelas/]) {
  await page.getByRole("radio", { name: tab }).click();
  await page.waitForTimeout(9000); // thumbnails stream in two at a time
  const report = await page.evaluate(async () => {
    const out = [];
    for (const card of document.querySelectorAll(".source-card")) {
      const name = card.querySelector(".source-name")?.textContent ?? "?";
      const img = card.querySelector("img");
      if (!img) {
        out.push({ name: name.slice(0, 28), thumbnail: false });
        continue;
      }
      await img.decode().catch(() => undefined);
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 27;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 48, 27);
      const data = ctx.getImageData(0, 0, 48, 27).data;
      let sum = 0;
      let varied = new Set();
      for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        varied.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      }
      out.push({
        name: name.slice(0, 28),
        thumbnail: true,
        size: `${img.naturalWidth}x${img.naturalHeight}`,
        meanBrightness: +(sum / (data.length / 4)).toFixed(1),
        distinctColors: varied.size,
      });
    }
    return out;
  });
  console.log(String(tab), "\n" + report.map((r) => "  " + JSON.stringify(r)).join("\n"));
}
await page.getByRole("button", { name: "Cancelar" }).click();
await browser.close();
