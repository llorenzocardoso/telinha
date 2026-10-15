import { expect, test } from "@playwright/test";
import { enterName, joinRoom, people, startSyntheticShare } from "./helpers";

test("troca o que a live mostra sem encerrar nem reconectar quem assiste", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await Promise.all([a.goto("/"), b.goto("/")]);

  await enterName(a, "Ana");
  await a.getByRole("button", { name: "Criar sala" }).click();
  const code = (await a.getByTestId("room-code").textContent())?.trim();
  await joinRoom(b, code!, "Bia", a);
  await startSyntheticShare(a);
  await (await people(b)).filter({ hasText: "Ana" }).getByRole("button", { name: "Assistir" }).click();

  const video = b.locator(".watch-pane video").first();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  const receivedTrack = () =>
    video.evaluate((element) => (element.srcObject as MediaStream).getVideoTracks()[0]?.id);
  const before = await receivedTrack();
  const decodedFrames = () =>
    video.evaluate((element) => element.getVideoPlaybackQuality().totalVideoFrames);

  await a.getByRole("button", { name: "Trocar o que compartilha" }).click();
  await a.getByRole("button", { name: "Escolher outra tela ou janela" }).click();

  // A live segue no ar para quem transmite...
  await expect(a.getByRole("button", { name: "Parar transmissão" })).toBeVisible();
  // ...e para quem assiste: a mesma conexão, a mesma faixa recebida, imagem sempre andando.
  const framesAfterSwitch = await decodedFrames();
  await expect.poll(decodedFrames).toBeGreaterThan(framesAfterSwitch + 30);
  expect(await receivedTrack()).toBe(before);
  await expect(b.getByText("A live acabou")).toHaveCount(0);
});
