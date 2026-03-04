const express = require("express");
const cors = require("cors");
const path = require("path");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

const PORT = Number(process.env.PORT || 3000);
const TIMEOUT = Number(process.env.TIMEOUT_MS || 20000);

const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Aviso HTML de ngrok en requests
const NGROK_HEADERS = { "ngrok-skip-browser-warning": "true" };

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ================= ESTADO (en memoria) ================= */

let servers = {};       // { [id]: { id, url, lastPulse, pulseCount, origin } }
let totalTimeouts = 0;
let backups = [];       // ["https://..."]
let isPrimary = true;
let lastActivity = Date.now();

/* ================= HELPERS ================= */

const now = () => Date.now();

function markPrimaryActivity() {
  isPrimary = true;
  lastActivity = now();
}

function getWorkersArray() {
  return Object.values(servers).map((w) => ({
    id: w.id,
    url: w.url,
    lastPulse: w.lastPulse,
    pulseCount: w.pulseCount || 0,
    origin: w.origin || "local",
  }));
}

function upsertWorker(worker, origin = "local") {
  if (!worker || !worker.id) return;

  const existing = servers[worker.id];

  const incomingLast = Number(worker.lastPulse || 0);
  const existingLast = Number(existing?.lastPulse || 0);

  if (!existing || incomingLast >= existingLast) {
    servers[worker.id] = {
      id: worker.id,
      url: worker.url || existing?.url || "unknown",
      lastPulse: incomingLast || now(),
      pulseCount: Number(worker.pulseCount || existing?.pulseCount || 0),
      origin,
    };
  }
}

// Replicación
function replicateToBackups() {
  const payload = { workers: getWorkersArray(), totalTimeouts };

  backups.forEach((backupUrl) => {
    fetch(`${backupUrl}/replicate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...NGROK_HEADERS,
      },
      body: JSON.stringify(payload),
    }).catch(() => console.log("⚠ Error replicando a", backupUrl));
  });
}

/* ================= WORKERS ================= */

// Register worker
app.post("/register", (req, res) => {
  const { id, url } = req.body;

  if (!id || !url) {
    return res.status(400).json({ error: "Se requiere id y url" });
  }

  markPrimaryActivity();

  servers[id] = {
    id,
    url,
    lastPulse: now(),
    pulseCount: 0,
    origin: "local",
  };

  replicateToBackups();
  return res.json({ message: "registrado" });
});

// ✅ Pulse
app.post("/pulse", (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: "Se requiere id" });
  }

  markPrimaryActivity();

  // Tolera si llega pulse primero
  if (!servers[id]) {
    servers[id] = {
      id,
      url: "unknown",
      lastPulse: now(),
      pulseCount: 1,
      origin: "local",
    };
  } else {
    servers[id].lastPulse = now();
    servers[id].pulseCount = (servers[id].pulseCount || 0) + 1;
    servers[id].origin = "local";
  }

  replicateToBackups();
  return res.json({ message: "pulso recibido" });
});

/* ================= BACKUPS / COORDINATORS ================= */

// Recibir replicación
app.post("/replicate", (req, res) => {
  let workers = [];

  if (Array.isArray(req.body)) {
    workers = req.body;
  } else if (Array.isArray(req.body.workers)) {
    workers = req.body.workers;
  } else {
    return res.status(400).json({ error: "Formato inválido" });
  }

  // si recibo replicación, por defecto soy backup
  isPrimary = false;

  workers.forEach((w) => upsertWorker(w, "replicated"));

  if (req.body && req.body.totalTimeouts !== undefined) {
    totalTimeouts = Number(req.body.totalTimeouts || 0);
  }

  return res.json({ message: "Replicación recibida correctamente" });
});

// Registrar backup sin que se duplique
app.post("/register-backup", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL requerida" });
  }

  if (!backups.includes(url)) {
    backups.push(url);
  }

  fetch(`${url}/coordinator-role`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...NGROK_HEADERS,
    },
    body: JSON.stringify({ role: "backup", primaryUrl: PUBLIC_URL }),
  }).catch(() => console.log("⚠ No se pudo notificar rol backup"));

  return res.json({ message: "Backup registrado", backups });
});

// Sync workers
app.get("/sync-workers", (req, res) => {
  const payload = Object.values(servers).map((w) => ({
    id: w.id,
    url: w.url,
    lastPulse: w.lastPulse,
  }));
  return res.json(payload);
});

// Forzar sincronización manual
app.post("/force-sync", async (req, res) => {
  if (backups.length === 0) {
    return res.status(400).json({ error: "No hay backups registrados" });
  }

  markPrimaryActivity();

  for (const backup of backups) {
    try {
      const response = await fetch(`${backup}/sync-workers`, {
        headers: { ...NGROK_HEADERS },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const workers = await response.json();

      if (Array.isArray(workers)) {
        workers.forEach((w) => upsertWorker(w, "replicated"));
      }

      replicateToBackups();

      return res.json({ message: "Sincronización completada" });
    } catch (e) {
      console.log("⚠ No se pudo sincronizar desde", backup, "-", e.message);
    }
  }

  return res.status(500).json({ error: "No se pudo sincronizar" });
});

app.post("/coordinator-role", (req, res) => {
  const { role } = req.body;

  if (role === "backup") isPrimary = false;
  if (role === "primary") markPrimaryActivity();

  return res.json({ message: "Rol actualizado" });
});

/* ================= DASHBOARD ENDPOINTS ================= */

app.get("/servers", (req, res) => res.json(servers));

app.get("/metrics", (req, res) => {
  res.json({
    totalServers: Object.keys(servers).length,
    totalTimeouts,
  });
});

app.get("/backups", (req, res) => res.json(backups));

app.get("/mode", (req, res) => {
  const actingPrimary = isPrimary && now() - lastActivity < TIMEOUT;
  res.json({ mode: actingPrimary ? "PRIMARY" : "BACKUP" });
});

/* ================= TIMEOUT CLEANER (rúbrica 40%) ================= */

// Elimina workes también replicados
setInterval(() => {
  const t = now();
  let removed = false;

  for (const id in servers) {
    if (t - servers[id].lastPulse > TIMEOUT) {
      delete servers[id];
      totalTimeouts++;
      removed = true;
    }
  }

  if (removed && backups.length > 0) {
    replicateToBackups();
  }
}, 5000);

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`✅ Coordinator corriendo en puerto ${PORT}`);
  console.log(`PUBLIC_URL = ${PUBLIC_URL}`);
  console.log(`TIMEOUT_MS = ${TIMEOUT}`);
});