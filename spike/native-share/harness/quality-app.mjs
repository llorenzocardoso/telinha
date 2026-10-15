// Picture quality of the NATIVE sender in the real app: the app (started with the debugging port)
// shares the quality-card window through its own picker; a headless Chrome viewer joins the room,
// watches, and the received frame is compared to the reference the window wrote.
//
// usage: node quality-app.mjs [seconds=15]
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import { measureFrame } from "./metrics.mjs";

const [seconds = "15"] = process.argv.slice(2);
const reference = fs.readFileSync(`${process.env.TEMP}\\telinha-quality-ref.png`).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const appBrowser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const host = appBrowser.contexts()[0].pages()[0];
await host.evaluate(() => localStorage.removeItem("telinha-active-session-v2"));
await host.reload();
await host.getByPlaceholder("Como você quer aparecer").fill("Anfitriao");
await host.evaluate(() => localStorage.setItem("telinha-share-audio", "0"));
await host.getByRole("button", { name: "Criar sala" }).click();
await host.getByTestId("room-code").waitFor();
const code = (await host.getByTestId("room-code").textContent())?.trim();

const chrome = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
});
const viewer = await (await chrome.newContext()).newPage();
await viewer.goto("http://localhost:1420/");
await viewer.getByPlaceholder("Como você quer aparecer").fill("Espectador");
await viewer.getByRole("textbox", { name: "Código ou link do convite" }).fill(code);
await viewer.getByRole("button", { name: "Entrar na sala" }).click();
await viewer.getByRole("button", { name: "Sair da sala" }).waitFor();

// The same settings as the Chrome run: 1080p, 60 fps, the 10 Mbps cap.
await host.getByRole("button", { name: /Compartilhar tela/ }).click();
await host.getByText("O que compartilhar").waitFor({ timeout: 15000 });
await host.getByRole("button", { name: /Janela de qualidade/ }).click(); // the grid comes first
await host.getByRole("button", { name: "Equilibrado" }).click(); // then the quality step
await host.getByRole("button", { name: "Compartilhar", exact: true }).click();
await host.getByRole("button", { name: /Parar transmissão|Parar minha transmissão/ }).waitFor({ timeout: 20000 });

const pin = viewer.getByRole("button", { name: "Fixar a lista de pessoas na lateral" });
if (await pin.count()) await pin.click();
await viewer.getByRole("button", { name: "Assistir" }).first().click();
await viewer.locator("video").first().waitFor({ timeout: 15000 });
await sleep(Number(seconds) * 1000);

const sender = await host.evaluate(() => window.__TAURI_INTERNALS__.invoke("native_share_stats"));
const quality = await measureFrame(viewer, "video", reference);
console.log("QUALITY native", JSON.stringify({ ...quality, sender }));

await chrome.close();
await appBrowser.close();
