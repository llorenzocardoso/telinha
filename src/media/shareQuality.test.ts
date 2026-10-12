import { describe, expect, it } from "vitest";
import {
  SHARE_PRESETS,
  bitrateFor,
  parseShareChoice,
  presetFor,
  serializeShareChoice,
  shareQualityFrom,
  shareSummary,
} from "./shareQuality";

describe("atalhos", () => {
  it("equivalem aos presets antigos, para ninguém notar mudança de qualidade", () => {
    expect(SHARE_PRESETS.map((preset) => [preset.label, preset.height, preset.fps])).toEqual([
      ["Equilibrado", 1080, 60],
      ["Nítido", 1440, 60],
      ["Leve", 720, 30],
    ]);
    // Os bitrates dos presets antigos: 10, 16 e 4 Mbps.
    expect(bitrateFor(1080, 60)).toBe(10_000_000);
    expect(bitrateFor(1440, 60)).toBe(16_000_000);
    expect(bitrateFor(720, 30)).toBe(4_000_000);
  });

  it("reconhece o atalho da combinação e devolve null quando é personalizada", () => {
    expect(presetFor({ height: 1080, fps: 60 })?.label).toBe("Equilibrado");
    expect(presetFor({ height: 1440, fps: 60 })?.label).toBe("Nítido");
    expect(presetFor({ height: 720, fps: 30 })?.label).toBe("Leve");
    expect(presetFor({ height: 1080, fps: 15 })).toBeNull();
    expect(presetFor({ height: 0, fps: 60 })).toBeNull();
  });
});

describe("shareSummary", () => {
  it("resume a combinação escolhida", () => {
    expect(shareSummary({ height: 1080, fps: 60 })).toBe("1080p · 60 fps");
    expect(shareSummary({ height: 0, fps: 30 })).toBe("Original · 30 fps");
  });
});

describe("shareQualityFrom", () => {
  it("manda largura e altura quando há limite", () => {
    expect(
      shareQualityFrom({ height: 1080, fps: 60 }, { includeAudio: true, preferH264: true }),
    ).toEqual({
      fps: 60,
      maxWidth: 1920,
      maxHeight: 1080,
      maxBitrate: 10_000_000,
      includeAudio: true,
      preferH264: true,
    });
  });

  it("Original não limita largura nem altura", () => {
    const quality = shareQualityFrom(
      { height: 0, fps: 60 },
      { includeAudio: false, preferH264: false },
    );
    expect(quality.maxWidth).toBe(0);
    expect(quality.maxHeight).toBeUndefined();
    expect(quality.maxBitrate).toBe(24_000_000);
  });
});

describe("parseShareChoice", () => {
  it("migra o índice do formato antigo sem perder a escolha", () => {
    expect(parseShareChoice("0")).toEqual({ height: 1080, fps: 60 });
    expect(parseShareChoice("1")).toEqual({ height: 1440, fps: 60 });
    expect(parseShareChoice("2")).toEqual({ height: 720, fps: 30 });
    // Índice fora da lista antiga cai no padrão.
    expect(parseShareChoice("7")).toEqual({ height: 1080, fps: 60 });
  });

  it("lê o formato novo", () => {
    expect(parseShareChoice('{"height":720,"fps":15}')).toEqual({ height: 720, fps: 15 });
    expect(parseShareChoice('{"height":0,"fps":30}')).toEqual({ height: 0, fps: 30 });
  });

  it("cai no padrão com valor ausente ou quebrado", () => {
    for (const raw of [null, "", "  ", "{", "[]", '{"height":999,"fps":99}']) {
      expect(parseShareChoice(raw)).toEqual({ height: 1080, fps: 60 });
    }
  });

  it("fecha o ciclo de gravar e ler", () => {
    const choice = { height: 1440, fps: 30 } as const;
    expect(parseShareChoice(serializeShareChoice(choice))).toEqual(choice);
  });
});
