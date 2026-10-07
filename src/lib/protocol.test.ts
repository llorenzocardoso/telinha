import { describe, expect, it } from "vitest";
import { parseServerSignal } from "./protocol";

const participant = {
  id: "user-0123456789abcdef0123456789abcdef",
  name: "Ana",
  sharing: false,
  connected: true,
};

describe("parseServerSignal", () => {
  it("valida hello e presença", () => {
    expect(
      parseServerSignal(JSON.stringify({ type: "hello", you: participant, participants: [participant] })),
    ).toMatchObject({ type: "hello" });
    expect(
      parseServerSignal({ type: "participant-presence", participantId: participant.id, connected: false }),
    ).toEqual({ type: "participant-presence", participantId: participant.id, connected: false });
  });

  it("valida os avisos de câmera", () => {
    expect(
      parseServerSignal({ type: "camera-started", participantId: participant.id, streamId: "stream-1" }),
    ).toEqual({ type: "camera-started", participantId: participant.id, streamId: "stream-1" });
    expect(parseServerSignal({ type: "camera-started", participantId: participant.id })).toBeNull();
    expect(parseServerSignal({ type: "camera-stopped", participantId: participant.id })).toEqual({
      type: "camera-stopped",
      participantId: participant.id,
    });
    expect(
      parseServerSignal({
        type: "participant-joined",
        participant: { ...participant, camera: true, cameraStreamId: "stream-1" },
      }),
    ).toMatchObject({ participant: { camera: true, cameraStreamId: "stream-1" } });
  });

  it("ignora mensagens incompletas ou desconhecidas", () => {
    expect(parseServerSignal("{" )).toBeNull();
    expect(parseServerSignal({ type: "offer", from: participant.id })).toBeNull();
    expect(parseServerSignal({ type: "future-message" })).toBeNull();
  });
});
