import { expect, test, type Page } from "@playwright/test";
import { enterName, joinRoom, startSyntheticShare } from "./helpers";

/**
 * Captura as telas do redesign para o README e para a conferência visual.
 * Fora da suíte automática de propósito: o nome não casa com o testMatch do Playwright, então
 * o CI não o executa. Para regerar as imagens do README:
 *
 *   npm run build --prefix server
 *   npx playwright test e2e/screenshots.manual.ts
 */
test("captura as telas do redesign", async ({ browser }) => {
  const size = { width: 1280, height: 800 };
  const contextA = await browser.newContext({ viewport: size });
  const contextB = await browser.newContext({ viewport: size });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await Promise.all([a.goto("/"), b.goto("/")]);

  const shot = async (page: Page, name: string) => {
    // Deixa a fonte e a transição assentarem antes de fotografar.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
  };

  // 1. Tela inicial, com o nome preenchido.
  await enterName(a, "Lorenzo");
  await shot(a, "telinha-home");

  await a.getByRole("button", { name: "Criar sala" }).click();
  const code = (await a.getByTestId("room-code").textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // 2. Sala esperando, com duas pessoas.
  await joinRoom(b, code!, "Ana", a);
  await shot(a, "telinha-room");

  // 3. Diálogo de compartilhar tela.
  await a.getByRole("button", { name: /Compartilhar tela/ }).click();
  await expect(a.getByRole("dialog", { name: "Compartilhar tela" })).toBeVisible();
  await shot(a, "telinha-share");

  // 4. Sala ao vivo, com a prévia.
  await a.getByRole("button", { name: "Escolher janela" }).click();
  await expect(a.getByRole("button", { name: "Parar transmissão" })).toBeVisible();
  await expect(a.locator("[data-testid='live-preview'] video")).toBeVisible();
  await shot(a, "telinha-live");

  // 5. Assistindo, com a dock flutuante visível.
  await b
    .getByTestId("participant")
    .filter({ hasText: "Lorenzo" })
    .getByRole("button", { name: "Assistir" })
    .click();
  await expect(b.locator(".watch-video video")).toBeVisible();
  await b.mouse.move(640, 400);
  await shot(b, "telinha-watch");

  await contextA.close();
  await contextB.close();
});
