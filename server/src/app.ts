import cors from "cors";
import express from "express";
import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CODE_CHARS,
  CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
  resolvePublicWsUrl,
  sanitizeDisplayName,
} from "./codes.js";
import {
  CURRENT_PROTOCOL_VERSION,
  MAX_SIGNAL_PAYLOAD_BYTES,
  SERVER_FEATURES,
  isProtocolError,
  parseClientAuthentication,
  parseClientSignal,
  readProtocolVersion,
} from "./protocol.js";
import { createIceServerProvider, type TurnProviderOptions } from "./turn.js";

const SEAT_TTL_MS = 2 * 60 * 1000;
const RECONNECT_GRACE_MS = 15 * 60 * 1000;
const EMPTY_ROOM_GRACE_MS = 15 * 60 * 1000;
const WS_HEARTBEAT_MS = 25 * 1000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ROOM_SIZE = 16;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const CREATE_LIMIT = 8;
const JOIN_LIMIT = 30;
const MAX_RATE_BUCKETS = 10_000;
const AUTHENTICATION_TIMEOUT_MS = 5_000;
const DEFAULT_CLIENT_ORIGINS = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
];

interface Seat {
  id: string;
  token: string;
  name: string;
  expiresAt: number;
}

interface Hold {
  id: string;
  token: string;
  name: string;
  sharing: boolean;
  cameraStreamId: string | null;
  expiresAt: number;
}

interface Participant {
  id: string;
  name: string;
  sharing: boolean;
  cameraStreamId: string | null;
  token: string;
  replaced: boolean;
  ws: WebSocket;
}

interface Room {
  createdAt: number;
  emptiedAt: number | null;
  seats: Map<string, Seat>;
  holds: Map<string, Hold>;
  participants: Map<string, Participant>;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export interface TelinhaServerOptions {
  publicWsUrl?: string;
  disableRateLimit?: boolean;
  trustProxy?: boolean;
  reconnectGraceMs?: number;
  emptyRoomGraceMs?: number;
  cleanupIntervalMs?: number;
  minProtocolVersion?: number;
  minAppVersion?: string;
  corsOrigins?: string[];
  maxRateBuckets?: number;
  authenticationTimeoutMs?: number;
  turn?: TurnProviderOptions;
}

export interface TelinhaServer {
  http: Server;
  close(): Promise<void>;
}

function createParticipantId(): string {
  return `user-${randomBytes(16).toString("hex")}`;
}

function createToken(): string {
  return randomBytes(24).toString("base64url");
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

interface ListedPerson {
  id: string;
  name: string;
  sharing: boolean;
  camera: boolean;
  cameraStreamId?: string;
  connected: boolean;
}

function publicParticipant(
  participant: Pick<Participant, "id" | "name" | "sharing" | "cameraStreamId">,
  connected = true,
): ListedPerson {
  return {
    id: participant.id,
    name: participant.name,
    sharing: participant.sharing,
    camera: participant.cameraStreamId !== null,
    cameraStreamId: participant.cameraStreamId ?? undefined,
    connected,
  };
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room: Room, payload: unknown, exceptId?: string) {
  for (const participant of room.participants.values()) {
    if (participant.id !== exceptId) {
      send(participant.ws, payload);
    }
  }
}

export function createTelinhaServer(options: TelinhaServerOptions = {}): TelinhaServer {
  const rooms = new Map<string, Room>();
  const createHits = new Map<string, RateBucket>();
  const joinHits = new Map<string, RateBucket>();
  const configuredWsUrl = resolvePublicWsUrl(options.publicWsUrl);
  const reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS;
  const emptyRoomGraceMs = options.emptyRoomGraceMs ?? EMPTY_ROOM_GRACE_MS;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 5_000;
  const minProtocolVersion = options.minProtocolVersion ?? CURRENT_PROTOCOL_VERSION;
  const minAppVersion = options.minAppVersion?.trim() || "0.2.0";
  const iceServers = createIceServerProvider(options.turn);
  const maxRateBuckets = Math.max(1, options.maxRateBuckets ?? MAX_RATE_BUCKETS);
  const authenticationTimeoutMs =
    options.authenticationTimeoutMs ?? AUTHENTICATION_TIMEOUT_MS;
  const allowedOrigins = new Set(
    [...DEFAULT_CLIENT_ORIGINS, ...(options.corsOrigins ?? [])].map((origin) =>
      origin.trim().replace(/\/$/, ""),
    ),
  );

  function originAllowed(origin: string | undefined): boolean {
    return !origin || allowedOrigins.has(origin.replace(/\/$/, ""));
  }

  function generateCode(): string {
    let code = "";
    const bytes = randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[bytes[i]! % CODE_CHARS.length];
    }
    if (rooms.has(code)) {
      return generateCode();
    }
    return code;
  }

  function pruneSeats(room: Room, now = Date.now()) {
    for (const [id, seat] of room.seats) {
      if (seat.expiresAt <= now) {
        room.seats.delete(id);
      }
    }
  }

  function expireHolds(room: Room, now = Date.now()) {
    for (const [id, hold] of room.holds) {
      if (hold.expiresAt <= now) {
        room.holds.delete(id);
        broadcast(room, { type: "participant-left", participantId: id });
      }
    }
  }

  function roomOccupancy(room: Room): number {
    pruneSeats(room);
    expireHolds(room);
    return room.seats.size + room.holds.size + room.participants.size;
  }

  function roomIsEmpty(room: Room): boolean {
    return room.participants.size === 0 && room.seats.size === 0 && room.holds.size === 0;
  }

  function markRoomActivity(room: Room) {
    if (roomIsEmpty(room)) {
      room.emptiedAt ??= Date.now();
    } else {
      room.emptiedAt = null;
    }
  }

  function shouldDropRoom(room: Room, now = Date.now()): boolean {
    pruneSeats(room, now);
    expireHolds(room, now);
    if (!roomIsEmpty(room)) {
      room.emptiedAt = null;
      return false;
    }
    room.emptiedAt ??= now;
    return now - room.emptiedAt > emptyRoomGraceMs || now - room.createdAt > ROOM_TTL_MS;
  }

  function createEmptyRoom(): Room {
    return {
      createdAt: Date.now(),
      emptiedAt: null,
      seats: new Map(),
      holds: new Map(),
      participants: new Map(),
    };
  }

  function issueSeat(room: Room, displayName: string): Seat {
    const seat: Seat = {
      id: createParticipantId(),
      token: createToken(),
      name: displayName,
      expiresAt: Date.now() + SEAT_TTL_MS,
    };
    room.seats.set(seat.id, seat);
    return seat;
  }

  function consumeSeat(room: Room, participantId: string, token: string): Seat | null {
    pruneSeats(room);
    const seat = room.seats.get(participantId);
    if (!seat || seat.expiresAt <= Date.now() || !tokensEqual(seat.token, token)) {
      return null;
    }
    room.seats.delete(participantId);
    return seat;
  }

  function reclaimHold(room: Room, participantId: string, token: string): Hold | null {
    expireHolds(room);
    const hold = room.holds.get(participantId);
    if (!hold || hold.expiresAt <= Date.now() || !tokensEqual(hold.token, token)) {
      return null;
    }
    room.holds.delete(participantId);
    return hold;
  }

  function getRoom(code: string): Room | undefined {
    return rooms.get(normalizeRoomCode(code));
  }

  function parkParticipant(code: string, participantId: string) {
    const room = getRoom(code);
    if (!room) return;
    const participant = room.participants.get(participantId);
    if (!participant || participant.replaced) return;
    room.participants.delete(participantId);
    room.holds.set(participantId, {
      id: participant.id,
      token: participant.token,
      name: participant.name,
      sharing: participant.sharing,
      cameraStreamId: participant.cameraStreamId,
      expiresAt: Date.now() + reconnectGraceMs,
    });
    broadcast(room, { type: "participant-presence", participantId, connected: false });
    pruneSeats(room);
    expireHolds(room);
    markRoomActivity(room);
  }

  function dismissParticipant(code: string, participantId: string) {
    const room = getRoom(code);
    if (!room) return;
    const participant = room.participants.get(participantId);
    if (participant) {
      participant.replaced = true;
      room.participants.delete(participantId);
    }
    room.holds.delete(participantId);
    room.seats.delete(participantId);
    broadcast(room, { type: "participant-left", participantId });
    participant?.ws.close(1000, "Participant left");
    pruneSeats(room);
    expireHolds(room);
    markRoomActivity(room);
  }

  function listedPeople(room: Room) {
    const people = new Map<string, ListedPerson>();
    for (const hold of room.holds.values()) {
      people.set(hold.id, publicParticipant(hold, false));
    }
    for (const participant of room.participants.values()) {
      people.set(participant.id, publicParticipant(participant));
    }
    return [...people.values()];
  }

  function wsUrlFromRequest(req: express.Request): string {
    if (configuredWsUrl) {
      return configuredWsUrl;
    }
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
    const host = req.headers.host ?? "localhost";
    const wsProto = proto === "https" ? "wss" : "ws";
    return `${wsProto}://${host}/ws`;
  }

  async function sessionPayload(req: express.Request, code: string, seat: Seat, displayName: string) {
    return {
      code,
      participantId: seat.id,
      token: seat.token,
      displayName,
      wsUrl: wsUrlFromRequest(req),
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      wsAuthMode: "message" as const,
      features: SERVER_FEATURES,
      iceServers: await iceServers.getIceServers(),
    };
  }

  function bearerToken(req: express.Request): string {
    const [scheme, token = ""] = (req.header("authorization") ?? "").split(/\s+/, 2);
    return scheme.toLowerCase() === "bearer" ? token : "";
  }

  function findIdentity(room: Room, participantId: string) {
    return (
      room.participants.get(participantId) ??
      room.holds.get(participantId) ??
      room.seats.get(participantId)
    );
  }

  function clientIp(req: express.Request): string {
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  function consumeRate(map: Map<string, RateBucket>, ip: string, limit: number): boolean {
    const now = Date.now();
    let bucket = map.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      for (const [key, current] of map) {
        if (now >= current.resetAt) {
          map.delete(key);
        }
      }
      while (map.size >= maxRateBuckets) {
        const oldest = map.keys().next().value as string | undefined;
        if (!oldest) break;
        map.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      map.set(ip, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit;
  }

  function rateLimited(map: Map<string, RateBucket>, limit: number): express.RequestHandler {
    return (req, res, next) => {
      if (!options.disableRateLimit && !consumeRate(map, clientIp(req), limit)) {
        res.setHeader("Retry-After", String(Math.ceil(RATE_WINDOW_MS / 1000)));
        res.status(429).json({ error: "Muitas tentativas. Espere um pouco." });
        return;
      }
      next();
    };
  }

  const app = express();
  if (options.trustProxy) {
    app.set("trust proxy", 1);
  }
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, originAllowed(origin));
      },
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 24 * 60 * 60,
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  function requireProtocol(req: express.Request, res: express.Response, next: express.NextFunction) {
    const version = readProtocolVersion(req.body?.protocolVersion);
    if (version < minProtocolVersion) {
      res.status(426).json({
        error: "Esta versão do Telinha precisa ser atualizada.",
        code: "UPDATE_REQUIRED",
        minimumProtocolVersion: minProtocolVersion,
      });
      return;
    }
    next();
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "telinha-server" });
  });

  app.get("/app-config", (_req, res) => {
    res.json({ minAppVersion, minProtocolVersion });
  });

  app.post("/rooms", requireProtocol, rateLimited(createHits, CREATE_LIMIT), async (req, res) => {
    const displayName = sanitizeDisplayName(req.body?.displayName);
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "code")) {
      res.status(400).json({ error: "Código personalizado não é suportado." });
      return;
    }

    const code = generateCode();
    const room = createEmptyRoom();
    const seat = issueSeat(room, displayName);
    rooms.set(code, room);
    res.json(await sessionPayload(req, code, seat, displayName));
  });

  app.post("/rooms/:code/join", requireProtocol, rateLimited(joinHits, JOIN_LIMIT), async (req, res) => {
    const rawCode = req.params.code;
    const code = normalizeRoomCode(Array.isArray(rawCode) ? rawCode[0] ?? "" : rawCode ?? "");
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: "Código inválido." });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ error: "Sala não encontrada." });
      return;
    }
    if (roomOccupancy(room) >= MAX_ROOM_SIZE) {
      res.status(409).json({ error: "Essa sala está cheia." });
      return;
    }

    const displayName = sanitizeDisplayName(req.body?.displayName);
    const seat = issueSeat(room, displayName);
    room.emptiedAt = null;
    res.json(await sessionPayload(req, code, seat, displayName));
  });

  app.get("/rooms/:code/ice-servers", async (req, res) => {
    const rawCode = req.params.code;
    const code = normalizeRoomCode(Array.isArray(rawCode) ? rawCode[0] ?? "" : rawCode ?? "");
    const participantId = typeof req.query.participantId === "string" ? req.query.participantId : "";
    const token = bearerToken(req);
    const room = isValidRoomCode(code) ? rooms.get(code) : undefined;
    const identity = room && participantId ? findIdentity(room, participantId) : undefined;
    if (!room || !identity || !token || !tokensEqual(identity.token, token)) {
      res.status(403).json({ error: "Token de participante inválido." });
      return;
    }
    res.json({ iceServers: await iceServers.getIceServers() });
  });

  app.delete("/rooms/:code/participants/:participantId", (req, res) => {
    const rawCode = req.params.code;
    const code = normalizeRoomCode(Array.isArray(rawCode) ? rawCode[0] ?? "" : rawCode ?? "");
    const rawParticipantId = req.params.participantId;
    const participantId = Array.isArray(rawParticipantId)
      ? rawParticipantId[0] ?? ""
      : rawParticipantId ?? "";
    const authorization = req.header("authorization") ?? "";
    const [scheme, token = ""] = authorization.split(/\s+/, 2);

    const room = rooms.get(code);
    if (!room) {
      res.status(204).end();
      return;
    }
    const identity =
      room.participants.get(participantId) ??
      room.holds.get(participantId) ??
      room.seats.get(participantId);
    if (!identity) {
      res.status(204).end();
      return;
    }
    if (scheme.toLowerCase() !== "bearer" || !tokensEqual(identity.token, token)) {
      res.status(403).json({ error: "Token de participante inválido." });
      return;
    }

    dismissParticipant(code, participantId);
    res.status(204).end();
  });

  const http = createServer(app);
  const wss = new WebSocketServer({
    server: http,
    path: "/ws",
    maxPayload: MAX_SIGNAL_PAYLOAD_BYTES,
  });

  function wireSocket(ws: WebSocket, room: Room, code: string, participant: Participant) {
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }, WS_HEARTBEAT_MS);
    heartbeat.unref();

    ws.on("message", (raw) => {
      const message = parseClientSignal(String(raw));
      if (isProtocolError(message)) {
        send(ws, { type: "error", code: "protocol-error", message: message.message });
        ws.close(1008, "Invalid signaling message");
        return;
      }

      if (message.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }

      if (message.type === "leave") {
        dismissParticipant(code, participant.id);
        ws.close();
        return;
      }

      const current = room.participants.get(participant.id);
      if (!current || current.ws !== ws) return;

      if (message.type === "share-started") {
        current.sharing = true;
        broadcast(room, { type: "share-started", participantId: participant.id, name: current.name }, participant.id);
        return;
      }

      if (message.type === "share-stopped") {
        current.sharing = false;
        broadcast(room, { type: "share-stopped", participantId: participant.id }, participant.id);
        return;
      }

      if (message.type === "camera-started") {
        current.cameraStreamId = message.streamId;
        broadcast(
          room,
          { type: "camera-started", participantId: participant.id, streamId: message.streamId },
          participant.id,
        );
        return;
      }

      if (message.type === "camera-stopped") {
        current.cameraStreamId = null;
        broadcast(room, { type: "camera-stopped", participantId: participant.id }, participant.id);
        return;
      }

      if (
        (message.type === "watch-started" || message.type === "watch-stopped") &&
        typeof message.to === "string"
      ) {
        const target = room.participants.get(message.to);
        if (!target || target.id === participant.id) return;
        if (message.type === "watch-started" && !target.sharing) return;
        send(target.ws, {
          type: message.type,
          from: participant.id,
          to: target.id,
          name: current.name,
        });
        return;
      }

      if (
        (message.type === "offer" || message.type === "answer" || message.type === "ice") &&
        typeof message.to === "string"
      ) {
        const target = room.participants.get(message.to);
        if (!target) return;
        if (message.type === "ice") {
          send(target.ws, {
            type: message.type,
            from: participant.id,
            candidate: message.candidate,
          });
        } else {
          send(target.ws, {
            type: message.type,
            from: participant.id,
            sdp: message.sdp,
          });
        }
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      const current = room.participants.get(participant.id);
      if (!current || current.ws !== ws) return;
      parkParticipant(code, participant.id);
    });
  }

  function greet(ws: WebSocket, room: Room, participant: Participant) {
    send(ws, {
      type: "hello",
      you: publicParticipant(participant),
      participants: listedPeople(room),
    });
  }

  function rejectOutdatedClient(ws: WebSocket) {
    send(ws, {
      type: "error",
      code: "update-required",
      message: "Esta versão do Telinha precisa ser atualizada.",
    });
    ws.close(1008, "Update required");
  }

  function admitSocket(
    ws: WebSocket,
    rawCode: string,
    participantId: string,
    token: string,
    protocolVersion: number,
  ) {
    if (protocolVersion < minProtocolVersion) {
      rejectOutdatedClient(ws);
      return;
    }
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      send(ws, { type: "error", message: "Sala inválida." });
      ws.close(1008, "Invalid room");
      return;
    }
    const room = rooms.get(code);
    const live = room?.participants.get(participantId);
    if (room && live && tokensEqual(live.token, token)) {
      live.replaced = true;
      const previous = live.ws;
      live.ws = ws;
      live.replaced = false;
      wireSocket(ws, room, code, live);
      previous.close();
      greet(ws, room, live);
      return;
    }

    const hold = room ? reclaimHold(room, participantId, token) : null;
    const seat = room && !hold ? consumeSeat(room, participantId, token) : null;
    const admitted = hold ?? seat;

    if (!room || !admitted) {
      send(ws, { type: "error", message: "Sala inválida." });
      ws.close(1008, "Invalid session");
      return;
    }

    const participant: Participant = {
      id: admitted.id,
      name: admitted.name,
      sharing: "sharing" in admitted ? Boolean(admitted.sharing) : false,
      cameraStreamId: hold?.cameraStreamId ?? null,
      token,
      replaced: false,
      ws,
    };
    room.participants.set(participant.id, participant);
    wireSocket(ws, room, code, participant);
    greet(ws, room, participant);
    if (hold) {
      broadcast(
        room,
        { type: "participant-presence", participantId: participant.id, connected: true },
        participant.id,
      );
    } else {
      broadcast(
        room,
        { type: "participant-joined", participant: publicParticipant(participant) },
        participant.id,
      );
    }
  }

  wss.on("connection", (ws, req) => {
    ws.on("error", () => {
      // Limites de payload e falhas de transporte encerram o socket; o evento close faz o cleanup.
    });

    if (!originAllowed(req.headers.origin)) {
      send(ws, {
        type: "error",
        code: "origin-not-allowed",
        message: "Origem não permitida.",
      });
      ws.close(1008, "Origin not allowed");
      return;
    }

    const url = new URL(req.url ?? "/ws", "http://localhost");
    const advertisedVersion = readProtocolVersion(
      Number(url.searchParams.get("protocolVersion")),
    );
    if (advertisedVersion > 0 && advertisedVersion < minProtocolVersion) {
      rejectOutdatedClient(ws);
      return;
    }

    const hasLegacyAuthentication =
      url.searchParams.has("code") ||
      url.searchParams.has("participantId") ||
      url.searchParams.has("token");
    if (hasLegacyAuthentication) {
      admitSocket(
        ws,
        url.searchParams.get("code") ?? "",
        url.searchParams.get("participantId") ?? "",
        url.searchParams.get("token") ?? "",
        advertisedVersion,
      );
      return;
    }

    const timeout = setTimeout(() => {
      send(ws, {
        type: "error",
        code: "authentication-timeout",
        message: "Autenticação não recebida.",
      });
      ws.close(1008, "Authentication timeout");
    }, authenticationTimeoutMs);
    timeout.unref();

    const clearAuthenticationTimeout = () => clearTimeout(timeout);
    ws.once("close", clearAuthenticationTimeout);
    ws.once("message", (raw) => {
      clearAuthenticationTimeout();
      const authentication = parseClientAuthentication(String(raw));
      if (!("type" in authentication)) {
        send(ws, {
          type: "error",
          code: "authentication-error",
          message: authentication.message,
        });
        ws.close(1008, "Invalid authentication");
        return;
      }
      admitSocket(
        ws,
        authentication.code,
        authentication.participantId,
        authentication.token,
        authentication.protocolVersion,
      );
    });
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (shouldDropRoom(room, now)) {
        rooms.delete(code);
      }
    }
    for (const hits of [createHits, joinHits]) {
      for (const [ip, bucket] of hits) {
        if (now >= bucket.resetAt) {
          hits.delete(ip);
        }
      }
    }
  }, cleanupIntervalMs);
  cleanup.unref();

  return {
    http,
    close() {
      clearInterval(cleanup);
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise((resolve, reject) => {
        wss.close((wsError) => {
          http.close((httpError) => {
            const error = wsError ?? httpError;
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}
