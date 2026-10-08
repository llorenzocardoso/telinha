import { beforeEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "./protocol";
import {
  buildDiagnostics,
  clearDiagnostics,
  recordDiagnostic,
  sanitizeDiagnosticDetails,
} from "./diagnostics";

describe("diagnóstico local", () => {
  beforeEach(clearDiagnostics);

  it("remove dados sensíveis", () => {
    expect(
      sanitizeDiagnosticDetails({
        token: "secret",
        sdp: "v=0",
        candidate: "candidate:1",
        code: "AB12CD",
        message: "falhou",
        roundTripTimeMs: 45,
      }),
    ).toEqual({ message: "falhou", roundTripTimeMs: 45 });
  });

  it("gera relatório local versionado", () => {
    recordDiagnostic("peer-state", { state: "connected" });
    const report = JSON.parse(buildDiagnostics()) as Record<string, unknown>;
    expect(report).toMatchObject({ appVersion: APP_VERSION, protocolVersion: 2 });
    expect(report.events).toEqual(expect.arrayContaining([expect.objectContaining({ event: "peer-state" })]));
  });
});
