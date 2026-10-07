import { describe, expect, it } from "vitest";
import { cameraConstraints, cameraErrorMessage, describeCameras } from "./camera";

describe("câmera", () => {
  it("pede 720p sem áudio e só fixa o dispositivo quando há um escolhido", () => {
    const fallback = cameraConstraints(null);
    expect(fallback.audio).toBe(false);
    expect(fallback.video).toMatchObject({ width: { ideal: 1280 }, frameRate: { ideal: 30 } });
    expect(fallback.video).not.toHaveProperty("deviceId");

    expect(cameraConstraints("cam-2").video).toMatchObject({ deviceId: { exact: "cam-2" } });
  });

  it("lista apenas câmeras e dá nome às que vêm sem rótulo", () => {
    expect(
      describeCameras([
        { kind: "audioinput", deviceId: "mic", label: "Microfone" },
        { kind: "videoinput", deviceId: "a", label: "Integrated Camera (04f2:b6d0)" },
        { kind: "videoinput", deviceId: "b", label: "" },
        { kind: "videoinput", deviceId: "", label: "" },
      ]),
    ).toEqual([
      { deviceId: "a", label: "Integrated Camera" },
      { deviceId: "b", label: "Câmera 2" },
    ]);
  });

  it("traduz as falhas mais comuns do getUserMedia", () => {
    expect(cameraErrorMessage({ name: "NotAllowedError" })).toContain("negado");
    expect(cameraErrorMessage({ name: "NotReadableError" })).toContain("em uso");
    expect(cameraErrorMessage({ name: "NotFoundError" })).toContain("Nenhuma câmera");
    expect(cameraErrorMessage(new Error("x"))).toBe("Não foi possível ligar a câmera.");
  });
});
