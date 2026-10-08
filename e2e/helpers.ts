import { expect, type Page } from "@playwright/test";

export async function enterName(page: Page, name: string) {
  await page.getByPlaceholder("Como você quer aparecer").fill(name);
  await page.evaluate(() => localStorage.setItem("telinha-share-audio", "0"));
}

export async function startSyntheticShare(page: Page) {
  await page.getByRole("button", { name: /Compartilhar tela|Transmitir também/ }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
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
