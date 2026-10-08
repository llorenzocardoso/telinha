import { describe, expect, it } from "vitest";
import { isRelayRoute, videoBitrateFor } from "./relay";

describe("isRelayRoute", () => {
  it("reconhece relay em qualquer ponta escolhida", () => {
    expect(isRelayRoute({ selectedLocalType: "relay", selectedRemoteType: "srflx" })).toBe(true);
    expect(isRelayRoute({ selectedLocalType: "srflx", selectedRemoteType: "relay" })).toBe(true);
    expect(isRelayRoute({ candidateType: "relay" })).toBe(true);
  });

  it("não considera relay uma rota direta ou desconhecida", () => {
    expect(isRelayRoute({ selectedLocalType: "host", selectedRemoteType: "host" })).toBe(false);
    expect(isRelayRoute({ selectedLocalType: "srflx", selectedRemoteType: "prflx" })).toBe(false);
    expect(isRelayRoute({})).toBe(false);
  });
});

describe("videoBitrateFor", () => {
  it("limita no relay, em bits por segundo", () => {
    expect(videoBitrateFor(10_000_000, 900, true)).toBe(900_000);
  });

  it("deixa a rota direta intacta", () => {
    expect(videoBitrateFor(10_000_000, 900, false)).toBe(10_000_000);
  });

  it("não mexe quando não há teto", () => {
    expect(videoBitrateFor(10_000_000, null, true)).toBe(10_000_000);
    expect(videoBitrateFor(10_000_000, undefined, true)).toBe(10_000_000);
    expect(videoBitrateFor(10_000_000, 0, true)).toBe(10_000_000);
  });

  it("nunca aumenta o bitrate escolhido", () => {
    expect(videoBitrateFor(4_000_000, 9_000, true)).toBe(4_000_000);
  });
});
