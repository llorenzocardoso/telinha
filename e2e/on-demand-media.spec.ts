import { expect, test, type Page } from "@playwright/test";
import { enterName, joinRoom, startSyntheticShare } from "./helpers";

function peerIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __telinhaDebug: { peerIds: () => string[] } }).__telinhaDebug.peerIds(),
  );
}

async function expectPeerCount(page: Page, count: number) {
  await expect.poll(async () => (await peerIds(page)).length).toBe(count);
}

async function expectVideoPlaying(page: Page) {
  const video = page.locator(".watch-pane video").first();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
}

test("envia mídia só a quem assiste e libera ao parar", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const c = await contextC.newPage();
  let bSignalingSockets = 0;
  b.on("websocket", (socket) => {
    if (socket.url().includes("/ws?")) bSignalingSockets += 1;
  });
  await Promise.all([a.goto("/"), b.goto("/"), c.goto("/")]);

  await enterName(a, "Ana");
  await a.getByRole("button", { name: "Criar sala" }).click();
  const code = (await a.getByTestId("room-code").textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  await joinRoom(b, code!, "Bia", a);
  await joinRoom(c, code!, "Caio", a);

  // ONDEM-01: transmitir não abre conexão com ninguém.
  await startSyntheticShare(a);
  await expect(b.getByTestId("participant").filter({ hasText: "Ana" }).getByRole("button", { name: "Assistir" })).toBeVisible();
  await expect(c.getByTestId("participant").filter({ hasText: "Ana" }).getByRole("button", { name: "Assistir" })).toBeVisible();
  await expectPeerCount(a, 0);
  await expectPeerCount(b, 0);
  await expectPeerCount(c, 0);

  // ONDEM-02: só quem assiste recebe.
  await b.getByTestId("participant").filter({ hasText: "Ana" }).getByRole("button", { name: "Assistir" }).click();
  await expectVideoPlaying(b);
  await expectPeerCount(a, 1);
  await expectPeerCount(b, 1);
  await expectPeerCount(c, 0);

  // ONDEM-08/09: Caio vê "Conectando…" e depois o vídeo.
  await c.evaluate(() => {
    const seen = { connecting: false };
    (window as unknown as { __seenConnecting: typeof seen }).__seenConnecting = seen;
    new MutationObserver(() => {
      if (document.querySelector(".watch-pane .video-placeholder")?.textContent?.includes("Conectando…")) {
        seen.connecting = true;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await c.getByTestId("participant").filter({ hasText: "Ana" }).getByRole("button", { name: "Assistir" }).click();
  await expectVideoPlaying(c);
  expect(
    await c.evaluate(
      () => (window as unknown as { __seenConnecting: { connecting: boolean } }).__seenConnecting.connecting,
    ),
  ).toBe(true);
  await expectPeerCount(a, 2);
  await expectPeerCount(c, 1);

  // ONDEM-11/13: Caio para de assistir; sobra só Bia.
  await c.getByRole("button", { name: "Parar de assistir" }).click();
  await expectPeerCount(c, 0);
  await expectPeerCount(a, 1);
  await expectPeerCount(b, 1);

  // ONDEM-15: Bia perde a rede e a live volta sem novo clique.
  await contextB.setOffline(true);
  await b.waitForTimeout(500);
  await contextB.setOffline(false);
  await expect.poll(() => bSignalingSockets).toBe(2);
  await expectVideoPlaying(b);
  await expectPeerCount(a, 1);

  // ONDEM-12: Ana para de transmitir e ninguém mantém conexão.
  await a.getByRole("button", { name: /Parar transmissão|Parar minha transmissão/ }).click();
  await expectPeerCount(a, 0);
  await expectPeerCount(b, 0);
  await expectPeerCount(c, 0);

  await contextA.close();
  await contextB.close();
  await contextC.close();
});
