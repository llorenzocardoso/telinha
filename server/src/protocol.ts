export const CURRENT_PROTOCOL_VERSION = 2;
export const MAX_SIGNAL_PAYLOAD_BYTES = 64 * 1024;

const PARTICIPANT_ID = /^user-[a-f0-9]{32}$/;
const ROOM_CODE = /^[A-Z0-9]{6}$/;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const STREAM_ID = /^[A-Za-z0-9{}_-]{1,64}$/;
const MAX_SDP_LENGTH = 60 * 1024;

export const SERVER_FEATURES = ["camera"] as const;
const MAX_CANDIDATE_LENGTH = 8 * 1024;

export interface ClientAuthentication {
  type: "authenticate";
  code: string;
  participantId: string;
  token: string;
  protocolVersion: number;
  appVersion?: string;
}

export type ClientSignal =
  | { type: "ping" | "leave" | "share-started" | "share-stopped" | "camera-stopped" }
  | { type: "camera-started"; streamId: string }
  | { type: "watch-started" | "watch-stopped"; to: string }
  | { type: "offer"; to: string; sdp: string }
  | { type: "answer"; to: string; sdp: string }
  | { type: "ice"; to: string; candidate: Record<string, unknown> };

export interface ProtocolError {
  code: "invalid-json" | "invalid-message" | "payload-too-large";
  message: string;
}

export function readProtocolVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

export function parseClientAuthentication(
  raw: string,
): ClientAuthentication | ProtocolError {
  if (Buffer.byteLength(raw, "utf8") > MAX_SIGNAL_PAYLOAD_BYTES) {
    return { code: "payload-too-large", message: "Mensagem de autenticação muito grande." };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { code: "invalid-json", message: "Autenticação inválida." };
  }
  if (
    !isRecord(value) ||
    value.type !== "authenticate" ||
    typeof value.code !== "string" ||
    !ROOM_CODE.test(value.code) ||
    !validParticipantId(value.participantId) ||
    typeof value.token !== "string" ||
    !SESSION_TOKEN.test(value.token) ||
    readProtocolVersion(value.protocolVersion) === 0 ||
    (value.appVersion !== undefined &&
      (typeof value.appVersion !== "string" || value.appVersion.length > 32))
  ) {
    return { code: "invalid-message", message: "Autenticação inválida." };
  }

  return {
    type: "authenticate",
    code: value.code,
    participantId: value.participantId,
    token: value.token,
    protocolVersion: readProtocolVersion(value.protocolVersion),
    appVersion: value.appVersion,
  };
}

export function parseClientSignal(raw: string): ClientSignal | ProtocolError {
  if (Buffer.byteLength(raw, "utf8") > MAX_SIGNAL_PAYLOAD_BYTES) {
    return { code: "payload-too-large", message: "Mensagem de sinalização muito grande." };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { code: "invalid-json", message: "Mensagem de sinalização inválida." };
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return { code: "invalid-message", message: "Mensagem de sinalização inválida." };
  }

  if (
    value.type === "ping" ||
    value.type === "leave" ||
    value.type === "share-started" ||
    value.type === "share-stopped" ||
    value.type === "camera-stopped"
  ) {
    return { type: value.type };
  }
  if (value.type === "camera-started") {
    if (typeof value.streamId !== "string" || !STREAM_ID.test(value.streamId)) {
      return { code: "invalid-message", message: "Câmera inválida." };
    }
    return { type: "camera-started", streamId: value.streamId };
  }
  if (!validParticipantId(value.to)) {
    return { code: "invalid-message", message: "Destinatário inválido." };
  }
  if (value.type === "watch-started" || value.type === "watch-stopped") {
    return { type: value.type, to: value.to };
  }
  if (value.type === "offer" || value.type === "answer") {
    if (typeof value.sdp !== "string" || !value.sdp || value.sdp.length > MAX_SDP_LENGTH) {
      return { code: "invalid-message", message: "Descrição de sessão inválida." };
    }
    return { type: value.type, to: value.to, sdp: value.sdp };
  }
  if (value.type === "ice" && isRecord(value.candidate)) {
    const encoded = JSON.stringify(value.candidate);
    if (encoded.length <= MAX_CANDIDATE_LENGTH && validCandidate(value.candidate)) {
      return { type: "ice", to: value.to, candidate: value.candidate };
    }
  }
  return { code: "invalid-message", message: "Mensagem de sinalização desconhecida." };
}

export function isProtocolError(value: ClientSignal | ProtocolError): value is ProtocolError {
  return "code" in value;
}

function validParticipantId(value: unknown): value is string {
  return typeof value === "string" && PARTICIPANT_ID.test(value);
}

function validCandidate(value: Record<string, unknown>): boolean {
  if (typeof value.candidate !== "string" || value.candidate.length > 4096) return false;
  if (value.sdpMid != null && (typeof value.sdpMid !== "string" || value.sdpMid.length > 256)) {
    return false;
  }
  if (
    value.sdpMLineIndex != null &&
    (typeof value.sdpMLineIndex !== "number" || !Number.isInteger(value.sdpMLineIndex))
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
