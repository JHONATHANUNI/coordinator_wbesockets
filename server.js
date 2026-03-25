const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = Number(process.env.PORT || 3000);
const NODE_ID = String(process.env.ID || PORT);
const PUBLIC_URL = process.env.PUBLIC_URL || `ws://localhost:${PORT}`;
const isPrimary = String(process.env.PRIMARY || "true") === "true";
const TIMEOUT = Number(process.env.TIMEOUT || 20000);
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL || 5000);
const SYNC_INTERVAL = Number(process.env.SYNC_INTERVAL || 3000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let workers = new Map();
let backups = new Map();
let dashboardClients = new Set();
let backupConnections = new Map();
let totalTimeouts = 0;
let totalRegistrations = 0;
let lastSyncAt = null;

const now = () => Date.now();
const uid = () => crypto.randomUUID();

function safeSend(ws, payload) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  } catch {}
}

function getWorkerArray() {
  return Array.from(workers.values()).map((w) => ({
    id: w.id,
    url: w.url,
    lastPulse: w.lastPulse,
    pulseCount: w.pulseCount,
    status: now() - w.lastPulse <= TIMEOUT ? "alive" : "timeout"
  }));
}

function getBackupArray() {
  return Array.from(backups.values()).map((b) => ({
    id: b.id,
    url: b.url,
    lastSeen: b.lastSeen,
    connected: b.connected
  }));
}

function buildState() {
  const activeServers = Array.from(workers.values()).filter(
    (w) => now() - w.lastPulse <= TIMEOUT
  ).length;

  return {
    nodeId: NODE_ID,
    mode: isPrimary ? "PRIMARY" : "BACKUP",
    timestamp: new Date().toISOString(),
    totalServers: workers.size,
    activeServers,
    totalTimeouts,
    totalRegistrations,
    lastSyncAt,
    workers: getWorkerArray(),
    backups: getBackupArray()
  };
}

function broadcastDashboard(data) {
  const msg = JSON.stringify({
    type: "dashboard_update",
    ...data
  });

  for (const client of dashboardClients) {
    safeSend(client, JSON.parse(msg));
  }
}

function syncToBackups(state) {
  if (!isPrimary) return;

  for (const [url, ws] of backupConnections.entries()) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      safeSend(ws, {
        type: "sync_state",
        data: state
      });
    }
  }
}

function pushState() {
  const state = buildState();
  broadcastDashboard(state);
  if (isPrimary) syncToBackups(state);
}

function connectToBackup(url) {
  if (!url || backupConnections.has(url)) return;

  const ws = new WebSocket(url);

  ws.on("open", () => {
    backupConnections.set(url, ws);
    const prev = backups.get(url) || {
      id: uid(),
      url,
      lastSeen: now(),
      connected: true
    };

    backups.set(url, {
      ...prev,
      connected: true,
      lastSeen: now()
    });

    safeSend(ws, {
      type: "register_backup",
      url: PUBLIC_URL,
      nodeId: NODE_ID
    });

    pushState();
    console.log(`[${NODE_ID}] Conectado a backup: ${url}`);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "sync_ack") {
        lastSyncAt = new Date().toISOString();
      }
    } catch {}
  });

  ws.on("close", () => {
    backupConnections.delete(url);
    if (backups.has(url)) {
      const b = backups.get(url);
      backups.set(url, { ...b, connected: false, lastSeen: now() });
    }
    pushState();
    setTimeout(() => connectToBackup(url), 4000);
  });

  ws.on("error", () => {
    backupConnections.delete(url);
    if (backups.has(url)) {
      const b = backups.get(url);
      backups.set(url, { ...b, connected: false, lastSeen: now() });
    }
  });
}

function handleRegister(data, ws) {
  const id = String(data.id || "").trim();
  const url = String(data.url || PUBLIC_URL).trim();

  if (!id) {
    return safeSend(ws, {
      type: "error",
      message: "ID requerido"
    });
  }

  const existing = workers.get(id);
  workers.set(id, {
    id,
    url,
    ws,
    lastPulse: now(),
    pulseCount: existing ? existing.pulseCount || 0 : 0
  });

  totalRegistrations++;
  safeSend(ws, {
    type: "register-ok",
    id,
    nodeId: NODE_ID,
    mode: isPrimary ? "PRIMARY" : "BACKUP",
    backups: getBackupArray()
  });

  console.log(`[${NODE_ID}] Worker registrado: ${id}`);
  pushState();
}

function handlePulse(data, ws) {
  const id = String(data.id || "").trim();
  const worker = workers.get(id);

  if (!worker) {
    return safeSend(ws, {
      type: "error",
      message: "Worker no registrado"
    });
  }

  worker.lastPulse = now();
  worker.pulseCount = (worker.pulseCount || 0) + 1;
  worker.ws = ws;

  safeSend(ws, {
    type: "pulse-ok",
    id,
    ts: new Date().toISOString()
  });

  pushState();
}

function handleRegisterBackup(data, ws) {
  const url = String(data.url || "").trim();
  if (!url) {
    return safeSend(ws, {
      type: "error",
      message: "URL backup requerida"
    });
  }

  if (url === PUBLIC_URL) {
    return safeSend(ws, {
      type: "error",
      message: "No puedes registrarte a ti mismo"
    });
  }

  const prev = backups.get(url) || {
    id: uid(),
    url,
    lastSeen: now(),
    connected: true
  };

  backups.set(url, {
    ...prev,
    connected: true,
    lastSeen: now()
  });

  safeSend(ws, {
    type: "backup-ok",
    backups: getBackupArray(),
    nodeId: NODE_ID
  });

  console.log(`[${NODE_ID}] Backup registrado: ${url}`);
  connectToBackup(url);
  pushState();
}

wss.on("connection", (ws, req) => {
  const remote = req.socket.remoteAddress || "unknown";
  console.log(`[${NODE_ID}] Conexión entrante desde ${remote}`);

  ws.isAlive = true;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      switch (data.type) {
        case "dashboard_connect":
          dashboardClients.add(ws);
          safeSend(ws, {
            type: "dashboard_update",
            ...buildState()
          });
          break;

        case "register":
          handleRegister(data, ws);
          break;

        case "pulse":
          handlePulse(data, ws);
          break;

        case "register_backup":
          handleRegisterBackup(data, ws);
          break;

        case "force_sync":
          safeSend(ws, {
            type: "dashboard_update",
            ...buildState()
          });
          break;

        case "sync_state":
          if (!isPrimary && data.data) {
            const incoming = data.data;
            workers = new Map((incoming.workers || []).map((w) => [w.id, { ...w, ws: null }]));
            backups = new Map((incoming.backups || []).map((b) => [b.url, b]));
            totalTimeouts = incoming.totalTimeouts || 0;
            totalRegistrations = incoming.totalRegistrations || totalRegistrations;
            lastSyncAt = new Date().toISOString();
            safeSend(ws, { type: "sync_ack", nodeId: NODE_ID });
            pushState();
          }
          break;

        case "pong":
          ws.isAlive = true;
          break;

        default:
          break;
      }
    } catch {}
  });

  ws.on("close", () => {
    dashboardClients.delete(ws);

    for (const [id, worker] of workers.entries()) {
      if (worker.ws === ws) {
        workers.delete(id);
      }
    }

    pushState();
  });
});

const heartbeatTimer = setInterval(() => {
  const t = now();

  for (const [id, worker] of workers.entries()) {
    if (t - worker.lastPulse > TIMEOUT) {
      workers.delete(id);
      totalTimeouts++;
      console.log(`[${NODE_ID}] Timeout worker: ${id}`);
    }
  }

  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.isAlive = false;
      safeSend(client, { type: "ping" });
    }
  }

  pushState();
}, HEARTBEAT_INTERVAL);

const backupSyncTimer = setInterval(() => {
  if (isPrimary) {
    pushState();
  }
}, SYNC_INTERVAL);

wss.on("close", () => {
  clearInterval(heartbeatTimer);
  clearInterval(backupSyncTimer);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  COORDINATOR SYSTEM                         ║
║  NODE: ${NODE_ID.padEnd(38 - String(NODE_ID).length)}║
║  URL: ${PUBLIC_URL.padEnd(39 - PUBLIC_URL.length)}║
║  MODE: ${(isPrimary ? "PRIMARY" : "BACKUP").padEnd(38 - (isPrimary ? 7 : 6))}║
╚══════════════════════════════════════════════╝
`);
});
