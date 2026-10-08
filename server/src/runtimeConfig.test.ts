import { describe, expect, it } from "vitest";
import {
  createRuntimeConfig,
  parseTurnEnabled,
  parseTurnMaxBitrateKbps,
} from "./runtimeConfig.js";

describe("parseTurnEnabled", () => {
  it("fica ligado quando a variável não diz o contrário", () => {
    for (const raw of [undefined, "", "  ", "1", "true", "on", "yes", "qualquer"]) {
      expect(parseTurnEnabled(raw)).toBe(true);
    }
  });

  it("desliga com os valores documentados, em qualquer caixa", () => {
    for (const raw of ["0", "false", "off", "no", "FALSE", " Off "]) {
      expect(parseTurnEnabled(raw)).toBe(false);
    }
  });
});

describe("parseTurnMaxBitrateKbps", () => {
  it("aceita só inteiro positivo", () => {
    expect(parseTurnMaxBitrateKbps("1500")).toBe(1500);
    expect(parseTurnMaxBitrateKbps(" 800 ")).toBe(800);
  });

  it("trata vazio e lixo como sem limite", () => {
    for (const raw of [undefined, "", "  ", "0", "-5", "1.5", "abc", "1e6", "1500kbps"]) {
      expect(parseTurnMaxBitrateKbps(raw)).toBeNull();
    }
  });
});

describe("createRuntimeConfig", () => {
  it("relê a fonte em cada chamada", () => {
    const env: { TURN_ENABLED?: string; TURN_MAX_BITRATE_KBPS?: string } = {};
    const config = createRuntimeConfig(() => env);
    expect(config.read()).toEqual({ turnEnabled: true, turnMaxBitrateKbps: null });

    env.TURN_ENABLED = "0";
    env.TURN_MAX_BITRATE_KBPS = "900";
    expect(config.read()).toEqual({ turnEnabled: false, turnMaxBitrateKbps: 900 });
  });
});
