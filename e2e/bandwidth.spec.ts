import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { enterName, joinRoom, startSyntheticShare } from "./helpers";

// Benchmark de upload da transmissora. Só roda com BENCH=1:
//   BENCH=1 BENCH_LABEL=depois npm run test:e2e -- -g bandwidth
// Variáveis: VIEWERS (quantos assistem, padrão 1), ROOM (tamanho da sala, padrão 4),
// WINDOW_S (janela de medição em segundos, padrão 10).
const ROOM = Number(process.env.ROOM ?? 4);
const VIEWERS = Number(process.env.VIEWERS ?? 1);
const WINDOW_S = Number(process.env.WINDOW_S ?? 10);
const LABEL = process.env.BENCH_LABEL ?? "medicao";

const TRACK_PEERS = () => {
  const w = window as unknown as { __pcs: RTCPeerConnection[] };
  w.__pcs = [];
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(...args: ConstructorParameters<typeof Native>) {
      super(...args);
      w.__pcs.push(this);
    }
  } as typeof RTCPeerConnection;
};

interface Sample {
  open: number;
  sent: number[];
  received: number[];
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
    const sent: number[] = [];
    const received: number[] = [];
    let open = 0;
    for (const pc of pcs) {
      if (pc.connectionState === "closed") {
        sent.push(0);
        received.push(0);
        continue;
      }
      open += 1;
      let s = 0;
      let r = 0;
      (await pc.getStats()).forEach((report) => {
        if (report.type === "outbound-rtp") s += Number(report.bytesSent ?? 0);
        if (report.type === "inbound-rtp") r += Number(report.bytesReceived ?? 0);
      });
      sent.push(s);
      received.push(r);
    }
    return { open, sent, received };
  });
}

function delta(a: Sample, b: Sample, key: "sent" | "received"): number {
  return b[key].reduce((total, value, i) => total + Math.max(0, value - (a[key][i] ?? 0)), 0);
}

test("bandwidth: upload da transmissora", async ({ browser }) => {
  test.skip(!process.env.BENCH, "defina BENCH=1 para rodar o benchmark");
  test.setTimeout(120_000);

  const names = ["Ana", "Bia", "Caio", "Dani", "Edu", "Fabi", "Gil", "Hugo"].slice(0, ROOM);
  const contexts = await Promise.all(names.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  await Promise.all(pages.map((page) => page.addInitScript(TRACK_PEERS)));
  await Promise.all(pages.map((page) => page.goto("/")));

  const [ana, ...others] = pages;
  await enterName(ana!, names[0]!);
  await ana!.getByRole("button", { name: "Criar sala" }).click();
  const code = (await ana!.locator(".lobby-code strong").textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  for (const [i, page] of others.entries()) await joinRoom(page, code!, names[i + 1]!, ana!);

  await startSyntheticShare(ana!);

  for (const page of others.slice(0, VIEWERS)) {
    await page.locator(".live-choice", { hasText: "Ana" }).click();
    const video = page.locator("video").first();
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
  }

  await ana!.waitForTimeout(3_000);
  const before = await Promise.all(pages.map(sample));
  await ana!.waitForTimeout(WINDOW_S * 1_000);
  const after = await Promise.all(pages.map(sample));

  const upBytes = delta(before[0]!, after[0]!, "sent");
  const result = {
    label: LABEL,
    room: ROOM,
    viewers: VIEWERS,
    windowSeconds: WINDOW_S,
    anaOpenConnections: after[0]!.open,
    anaUploadKbps: Math.round((upBytes * 8) / 1000 / WINDOW_S),
    nonViewersOpenConnections: after.slice(1 + VIEWERS).map((s) => s.open),
    viewerDownloadKbps: after
      .slice(1, 1 + VIEWERS)
      .map((s, i) => Math.round((delta(before[1 + i]!, s, "received") * 8) / 1000 / WINDOW_S)),
    nonViewerDownloadKbps: after
      .slice(1 + VIEWERS)
      .map((s, i) => Math.round((delta(before[1 + VIEWERS + i]!, s, "received") * 8) / 1000 / WINDOW_S)),
  };
  console.log("BENCH_RESULT " + JSON.stringify(result));
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/bandwidth-${LABEL}.json`, JSON.stringify(result, null, 2));

  await Promise.all(contexts.map((context) => context.close()));
});
