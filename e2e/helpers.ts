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
  await expect(host.getByText(name, { exact: false })).toBeVisible();
}

/**
 * A lista de pessoas fica num cartão que abre ao passar o mouse sobre os avatares do
 * cabeçalho; este helper abre o cartão e devolve as linhas.
 */
export async function people(page: Page) {
  // Com a lista fixa na lateral não há avatares para passar o mouse.
  const trigger = page.getByTestId("people-trigger");
  if (await trigger.count()) await trigger.hover();
  return page.getByTestId("participant");
}
