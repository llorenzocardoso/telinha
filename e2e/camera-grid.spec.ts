import { expect, test } from "@playwright/test";
import { enterName, joinRoom, startSyntheticShare } from "./helpers";

// Sem live no ar as câmeras ocupam o palco em grade; com live voltam a flutuar.
test("câmeras em grade, foco por clique e volta a flutuar com uma live", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await Promise.all([a.goto("/"), b.goto("/")]);

  await enterName(a, "Ana");
  await a.getByRole("button", { name: "Criar sala" }).click();
  const code = (await a.getByTestId("room-code").textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await joinRoom(b, code!, "Bia", a);

  await a.getByRole("button", { name: "Ligar câmera", exact: true }).click();
  await b.getByRole("button", { name: "Ligar câmera", exact: true }).click();

  // Sem transmissão: as duas câmeras ficam na grade do palco, nada flutuando.
  for (const page of [a, b]) {
    await expect(page.locator(".camera-grid .camera-cell")).toHaveCount(2);
    await expect(page.locator(".camera-tile")).toHaveCount(0);
    await expect(page.locator(".camera-grid.has-focus")).toHaveCount(0);
  }

  // Clicar numa câmera a põe em foco; a outra vira miniatura.
  await a.getByRole("button", { name: "Focar na câmera de Bia" }).click();
  await expect(a.locator(".camera-grid.has-focus")).toHaveCount(1);
  await expect(a.locator(".camera-grid-main .camera-cell")).toHaveCount(1);
  await expect(a.locator(".camera-grid-rail .camera-cell")).toHaveCount(1);
  // O foco é de quem clicou; a outra pessoa continua vendo a grade.
  await expect(b.locator(".camera-grid.has-focus")).toHaveCount(0);

  // Clicar na câmera em foco volta para a grade.
  await a.getByRole("button", { name: "Voltar para a grade (Bia)" }).click();
  await expect(a.locator(".camera-grid.has-focus")).toHaveCount(0);

  // Com uma live no ar, as câmeras saem da grade e viram quadrados flutuantes.
  await startSyntheticShare(a);
  await expect(a.locator(".camera-grid")).toHaveCount(0);
  await expect(a.locator(".camera-tile")).toHaveCount(2);
});
