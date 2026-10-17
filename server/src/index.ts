import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelinhaServer } from "./app.js";
import { CURRENT_PROTOCOL_VERSION } from "./protocol.js";

const envDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(envDir, "../.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const configuredMinProtocol = Number(
  process.env.MIN_PROTOCOL_VERSION ?? CURRENT_PROTOCOL_VERSION,
);
const minProtocolVersion = Number.isInteger(configuredMinProtocol) && configuredMinProtocol > 0
  ? configuredMinProtocol
  : CURRENT_PROTOCOL_VERSION;
const corsOrigins = process.env.CORS_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const turnTtl = Number(process.env.CLOUDFLARE_TURN_TTL_SECONDS);

const server = createTelinhaServer({
  publicWsUrl: process.env.WS_PUBLIC_URL,
  trustProxy: Boolean(process.env.RENDER || process.env.TRUST_PROXY === "1"),
  minProtocolVersion,
  minAppVersion: process.env.MIN_APP_VERSION,
  corsOrigins,
  webAppUrl: process.env.WEB_APP_URL?.trim() || undefined,
  turn: {
    keyId: process.env.CLOUDFLARE_TURN_KEY_ID,
    apiToken: process.env.CLOUDFLARE_TURN_API_TOKEN,
    ttlSeconds: Number.isFinite(turnTtl) ? turnTtl : undefined,
  },
});

server.http.listen(PORT, HOST, () => {
  console.log(`Telinha server rodando em http://${HOST}:${PORT}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server.close();
  } catch (error) {
    console.error("Falha ao encerrar o servidor Telinha.", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
