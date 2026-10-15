// Tiny UDP bottleneck: loss + serialization delay at a fixed rate + tail-drop queue + latency/jitter.
// One proxy = one ICE path. The client talks to `port`; packets are forwarded to the target and
// replies are routed back to the last client address seen.
import dgram from "node:dgram";

function makeLink(cfg, send) {
  const c = { rateKbps: Infinity, lossPct: 0, delayMs: 0, jitterMs: 0, queueMs: 200, ...cfg };
  let free = 0;
  const st = { sent: 0, lost: 0, queueDrops: 0, bytes: 0 };
  const push = (buf) => {
    const now = performance.now();
    if (Math.random() * 100 < c.lossPct) {
      st.lost++;
      return;
    }
    const tx = Number.isFinite(c.rateKbps) ? (buf.length * 8) / c.rateKbps : 0; // ms
    const start = Math.max(now, free);
    if (start - now > c.queueMs) {
      st.queueDrops++;
      return;
    }
    free = start + tx;
    const wait = Math.max(0, free + c.delayMs + Math.random() * c.jitterMs - now);
    st.sent++;
    st.bytes += buf.length;
    if (wait < 0.5) send(buf);
    else setTimeout(() => send(buf), wait);
  };
  return { push, st };
}

export async function startProxy({ targetIp, targetPort, toTarget = {}, toClient = {} }) {
  const front = dgram.createSocket("udp4");
  const back = dgram.createSocket("udp4");
  await new Promise((r) => front.bind(0, "0.0.0.0", r));
  await new Promise((r) => back.bind(0, "0.0.0.0", r));
  let client = null;
  let closed = false;
  const up = makeLink(toTarget, (b) => !closed && back.send(b, targetPort, targetIp));
  const down = makeLink(toClient, (b) => !closed && client && front.send(b, client.port, client.address));
  front.on("message", (msg, rinfo) => {
    client = rinfo;
    up.push(msg);
  });
  back.on("message", (msg) => down.push(msg));
  let timer = null;
  if (process.env.PROXY_LOG) {
    let prev = { up: 0, down: 0 };
    timer = setInterval(() => {
      const u = up.st, d = down.st;
      console.log(`[proxy ${front.address().port}] up ${u.sent - prev.up}/s (lost ${u.lost} qdrop ${u.queueDrops})  down ${d.sent - prev.down}/s (lost ${d.lost} qdrop ${d.queueDrops})`);
      prev = { up: u.sent, down: d.sent };
    }, 1000);
  }
  return {
    port: front.address().port,
    stats: () => ({ toTarget: up.st, toClient: down.st }),
    close: () => {
      closed = true;
      if (timer) clearInterval(timer);
      front.close();
      back.close();
    },
  };
}

export const SCENARIOS = {
  clean: {},
  // a typical constrained uplink: 6 Mbps, 150 ms of buffer
  bw6: { rateKbps: 6000, delayMs: 20, queueMs: 150 },
  // plenty of bandwidth, light random loss (wifi-like)
  loss1: { rateKbps: 20000, lossPct: 1, delayMs: 20, queueMs: 200 },
  // poor path: 4 Mbps, 2% loss, latency and jitter
  bad: { rateKbps: 4000, lossPct: 2, delayMs: 50, jitterMs: 10, queueMs: 200 },
};
