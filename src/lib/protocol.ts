export const PROTOCOL_VERSION = 2;
export const APP_VERSION = "0.4.0";

export interface SignalParticipant {
  id: string;
  name: string;
  sharing: boolean;
  connected: boolean;
  camera?: boolean;
  cameraStreamId?: string;
}

export interface ClientAuthentication {
  type: "authenticate";
  code: string;
  participantId: string;
  token: string;
  protocolVersion: number;
  appVersion: string;
}

export type ClientSignal =
  | { type: "ping" | "leave" | "share-started" | "share-stopped" | "camera-stopped" }
  | { type: "camera-started"; streamId: string }
  | { type: "watch-started" | "watch-stopped"; to: string }
  | { type: "offer" | "answer"; to: string; sdp: string }
  | { type: "ice"; to: string; candidate: RTCIceCandidateInit };

export type ServerSignal =
  | { type: "pong" | "ping" }
  | { type: "error"; message: string; code?: string }
  | { type: "hello"; you: SignalParticipant; participants: SignalParticipant[] }
  | { type: "participant-joined"; participant: SignalParticipant }
  | { type: "participant-left"; participantId: string }
  | { type: "participant-presence"; participantId: string; connected: boolean }
  | { type: "share-started"; participantId: string; name?: string }
  | { type: "share-stopped"; participantId: string }
  | { type: "camera-started"; participantId: string; streamId: string }
  | { type: "camera-stopped"; participantId: string }
  | { type: "watch-started" | "watch-stopped"; from: string; to: string; name?: string }
  | { type: "offer" | "answer"; from: string; sdp: string }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit };

export function parseServerSignal(raw: unknown): ServerSignal | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "pong" || value.type === "ping") return { type: value.type };
  if (value.type === "error" && typeof value.message === "string") {
    return {
      type: "error",
      message: value.message,
      code: typeof value.code === "string" ? value.code : undefined,
    };
  }
  if (value.type === "hello" && isParticipant(value.you) && Array.isArray(value.participants)) {
    const participants = value.participants.filter(isParticipant);
    if (participants.length !== value.participants.length) return null;
    return { type: "hello", you: value.you, participants };
  }
  if (value.type === "participant-joined" && isParticipant(value.participant)) {
    return { type: value.type, participant: value.participant };
  }
  if (value.type === "participant-left" && isId(value.participantId)) {
    return { type: value.type, participantId: value.participantId };
  }
  if (
    value.type === "participant-presence" &&
    isId(value.participantId) &&
    typeof value.connected === "boolean"
  ) {
    return { type: value.type, participantId: value.participantId, connected: value.connected };
  }
  if (value.type === "share-started" && isId(value.participantId)) {
    return {
      type: value.type,
      participantId: value.participantId,
      name: typeof value.name === "string" ? value.name : undefined,
    };
  }
  if (value.type === "share-stopped" && isId(value.participantId)) {
    return { type: value.type, participantId: value.participantId };
  }
  if (value.type === "camera-started" && isId(value.participantId) && isId(value.streamId)) {
    return { type: value.type, participantId: value.participantId, streamId: value.streamId };
  }
  if (value.type === "camera-stopped" && isId(value.participantId)) {
    return { type: value.type, participantId: value.participantId };
  }
  if (
    (value.type === "watch-started" || value.type === "watch-stopped") &&
    isId(value.from) &&
    isId(value.to)
  ) {
    return {
      type: value.type,
      from: value.from,
      to: value.to,
      name: typeof value.name === "string" ? value.name : undefined,
    };
  }
  if ((value.type === "offer" || value.type === "answer") && isId(value.from) && typeof value.sdp === "string") {
    return { type: value.type, from: value.from, sdp: value.sdp };
  }
  if (value.type === "ice" && isId(value.from) && isRecord(value.candidate)) {
    return { type: value.type, from: value.from, candidate: value.candidate as RTCIceCandidateInit };
  }
  return null;
}

function isParticipant(value: unknown): value is SignalParticipant {
  return (
    isRecord(value) &&
    isId(value.id) &&
    typeof value.name === "string" &&
    typeof value.sharing === "boolean" &&
    (typeof value.connected === "boolean" || value.connected === undefined) &&
    (typeof value.camera === "boolean" || value.camera === undefined) &&
    (value.cameraStreamId === undefined || isId(value.cameraStreamId))
  );
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
