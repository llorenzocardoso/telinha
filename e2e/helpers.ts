import { expect, type Page } from "@playwright/test";

export async function enterName(page: Page, name: string) {
  await page.getByPlaceholder("Como você quer aparecer").fill(name);
  await page.evaluate(() => localStorage.setItem("telinha-share-audio", "0"));
}

export async function startSyntheticShare(page: Page) {
  await page.getByRole("button", { name: /Compartilhar tela|Transmitir também/ }).click();
  await page.getByRole("button", { name: "Escolher janela" }).click();
  await expect(
    page.getByRole("button", { name: /Parar transmissão|Parar minha transmissão/ }),
  ).toBeVisible();
}

export async function joinRoom(page: Page, code: string, name: string, host: Page) {
  await enterName(page, name);
  await page.getByRole("textbox", { name: "Código ou link do convite" }).fill(code);
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  // Basta a pessoa estar na lista; o cartão recolhido só abre com o mouse em cima.
  await expect(host.getByTestId("participant").filter({ hasText: name })).toHaveCount(1);
}

/**
 * A lista de pessoas começa recolhida num cartão de hover. Fixá-la na lateral com um clique
 * é mais estável que depender do mouse parado sobre os avatares até chegar em "Assistir".
 * Idempotente: se a lista já está fixada, só devolve as linhas.
 */
export async function people(page: Page) {
  const pin = page.getByRole("button", { name: "Fixar a lista de pessoas na lateral" });
  if (await pin.count()) await pin.click();
  return page.getByTestId("participant");
}
