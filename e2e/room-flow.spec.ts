import { expect, test, type Page } from "@playwright/test";

async function enterName(page: Page, name: string) {
  await page.getByPlaceholder("Como você quer aparecer").fill(name);
  await page.evaluate(() => localStorage.setItem("telinha-share-audio", "0"));
}

async function startSyntheticShare(page: Page) {
  await page.getByRole("button", { name: /Compartilhar tela|Transmitir também/ }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(
    page.getByRole("button", { name: /Parar transmissão|Parar minha transmissão/ }),
  ).toBeVisible();
  const preview = page.locator("[data-testid='live-preview'] video");
  if (await preview.isVisible()) {
    await expect.poll(() => preview.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  }
}

async function watchAndAssertFrames(page: Page) {
  await page.getByRole("button", { name: "Assistir" }).first().click();
  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await expect(page.getByText("Clique para reproduzir")).toHaveCount(0);
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  await expect.poll(async () => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
}

async function resizeAndAssertVideoFits(page: Page) {
  for (const size of [
    { width: 640, height: 500 },
    { width: 900, height: 520 },
    { width: 640, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await expect.poll(async () =>
      page.locator(".video-area").evaluate((area) => {
        const video = area.querySelector("video");
        if (!video) return false;
        const outer = area.getBoundingClientRect();
        const inner = video.getBoundingClientRect();
        const tolerance = 1;
        return (
          inner.left >= outer.left - tolerance &&
          inner.top >= outer.top - tolerance &&
          inner.right <= outer.right + tolerance &&
          inner.bottom <= outer.bottom + tolerance &&
          getComputedStyle(video).objectFit === "contain"
        );
      }),
    ).toBe(true);
    await expect.poll(async () =>
      page.locator(".watch-controls-layer").evaluate((controls) => {
        const rect = controls.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight
        );
      }),
    ).toBe(true);
    await expect.poll(() =>
      page.evaluate(() => {
        const volume = document.querySelector(".watch-audio-controls")?.getBoundingClientRect();
        const fullscreen = document
          .querySelector(".watch-viewport-controls")
          ?.getBoundingClientRect();
        if (!volume || !fullscreen) return false;
        return volume.left < fullscreen.left && Math.abs(volume.bottom - fullscreen.bottom) <= 1;
      }),
    ).toBe(true);
  }
}

test("compartilha nos dois sentidos e não duplica ao sair e voltar", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const c = await contextC.newPage();
  await Promise.all([a.goto("/"), b.goto("/"), c.goto("/")]);

  await enterName(a, "Ana");
  await a.getByRole("button", { name: "Criar sala" }).click();
  const soundAlerts = a.getByRole("button", { name: "Silenciar avisos da sala" });
  await expect(soundAlerts).toBeVisible();
  await soundAlerts.click();
  await expect(a.getByRole("button", { name: "Ativar avisos da sala" })).toBeVisible();
  await a.getByRole("button", { name: "Ativar avisos da sala" }).click();
  await expect(a.getByRole("button", { name: "Sair da sala" })).toBeVisible();
  await expect(a.getByRole("button", { name: "Compartilhar tela" })).toBeVisible();
  await expect
    .poll(() =>
      a.evaluate(() => {
        const head = document.querySelector(".room-head")?.getBoundingClientRect();
        const body = document.querySelector(".room-body")?.getBoundingClientRect();
        const dock = document.querySelector(".ui-dock")?.getBoundingClientRect();
        if (!head || !body || !dock) return false;
        return (
          head.bottom <= body.top + 1 &&
          body.bottom <= dock.top + 1 &&
          dock.right <= window.innerWidth + 1 &&
          dock.bottom <= window.innerHeight + 1
        );
      }),
    )
    .toBe(true);
  const code = (await a.getByTestId("room-code").textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  await enterName(b, "Bia");
  await b.getByRole("textbox", { name: "Código ou link do convite" }).fill(code!);
  await b.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(a.getByText("Bia", { exact: false })).toBeVisible();

  await enterName(c, "Caio");
  await c.getByRole("textbox", { name: "Código ou link do convite" }).fill(code!);
  await c.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(a.getByText("Caio", { exact: false })).toBeVisible();

  await a.getByRole("button", { name: "Ligar câmera", exact: true }).click();
  await expect(a.locator(".camera-tile.local video")).toHaveCount(1);
  for (const viewer of [b, c]) {
    const camera = viewer.locator(".camera-tile video");
    await expect(camera).toHaveCount(1);
    await expect(viewer.locator(".camera-tile-name")).toHaveText("Ana");
    await expect.poll(() => camera.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  }

  await startSyntheticShare(a);
  await expect(b.getByTestId("participant").filter({ hasText: "Ana" }).getByRole("button", { name: "Assistir" })).toBeVisible();
  await watchAndAssertFrames(b);
  await resizeAndAssertVideoFits(b);
  await expect(b.getByRole("button", { name: "Transmitir também" })).toBeVisible();
  await expect(b.getByRole("button", { name: "Parar de assistir" })).toBeVisible();
  await expect(b.getByRole("button", { name: "Sair da sala" })).toBeVisible();
  await startSyntheticShare(b);
  await expect(b.getByRole("button", { name: "Parar minha transmissão" })).toBeVisible();

  await expect(
    c.getByTestId("participant").getByRole("button", { name: "Assistir" }),
  ).toHaveCount(2);
  await c.getByRole("button", { name: "Ver lado a lado" }).click();
  await expect(c.locator(".video-area video")).toHaveCount(2);
  await expect(c.locator(".watching-mosaic")).toBeVisible();
  await expect(c.getByRole("button", { name: "Ver em grade" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expect(a.getByTestId("participant").filter({ hasText: "Bia" }).getByRole("button", { name: "Assistir" })).toBeVisible();
  await a.getByTestId("participant").filter({ hasText: "Bia" }).getByRole("button", { name: "Assistir" }).click();
  await expect(a.getByRole("button", { name: "Parar minha transmissão" })).toBeVisible();
  await a.getByRole("button", { name: "Parar de assistir" }).click();
  await expect(a.getByRole("button", { name: "Parar transmissão" })).toBeVisible();

  await c.getByRole("button", { name: "Parar de assistir" }).click();
  await b.getByRole("button", { name: "Parar de assistir" }).click();
  await b.getByRole("button", { name: "Parar transmissão" }).click();
  await a.getByRole("button", { name: "Parar transmissão" }).click();

  await expect(b.locator(".camera-tile video")).toHaveCount(1);
  await a.getByRole("button", { name: "Desligar câmera", exact: true }).click();
  await expect(a.locator(".camera-tile")).toHaveCount(0);
  await expect(b.locator(".camera-tile")).toHaveCount(0);
  await expect(c.locator(".camera-tile")).toHaveCount(0);

  await b.getByRole("button", { name: "Sair da sala" }).click();
  await expect(b.getByRole("button", { name: "Entrar na sala" })).toBeVisible();
  await b.getByRole("textbox", { name: "Código ou link do convite" }).fill(code!);
  await b.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(a.getByTestId("participant").filter({ hasText: "Bia" })).toHaveCount(1);
  await expect(a.getByTestId("participant").filter({ hasText: "Reconectando" })).toHaveCount(0);

  await contextA.close();
  await contextB.close();
  await contextC.close();
});
