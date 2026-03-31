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
let isPrimary = String(process.env.PRIMARY || "true") === "true";
const TIMEOUT = Number(process.env.TIMEOUT || 20000);
const FAILOVER_GRACE = 15000; // 🔥 tiempo extra al volverse primary
let becamePrimaryAt = null;
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL || 5000);
const SYNC_INTERVAL = Number(process.env.SYNC_INTERVAL || 3000);
const MY_PRIORITY = Math.floor(Math.random() * 100) + 1;


// ================= FAILOVER =================
let lastPrimaryPulse = Date.now();
const PRIMARY_TIMEOUT = 10000; // 10s sin heartbeat = primary caído
let currentPrimaryId = null;
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let workers = new Map();
let backups = new Map();
let tasks = new Map();
let taskQueue = [];
let peers = new Map(); // reemplaza backups conceptualmente
let dashboardClients = new Set();
let backupConnections = new Map();
let totalTimeouts = 0;
let totalRegistrations = 0;
let lastSyncAt = null;


let currentLeader = {
  id: NODE_ID,
  url: PUBLIC_URL,
  priority: Math.floor(Math.random() * 100) + 1
};


const now = () => Date.now();
const uid = () => crypto.randomUUID();

// --------------------------------------------
// 1) WebSocket Utility Helpers
// --------------------------------------------

// Enviar saludo de descubrimiento al peer.
// Protocolo: hello
function sendHello(ws) {
  safeSend(ws, {
    type: "hello",
    data: {
      id: NODE_ID,
      url: PUBLIC_URL
    }
  });
}

// Enviar mensaje seguro a un socket abierto.
// Protege contra errores de socket no abiertos.
function safeSend(ws, payload) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  } catch {}
}

// Enviar log al dashboard además del console local.
// Esto es clave para la visibilidad y evaluación.
function log(msg) {
  console.log(msg);
  broadcastDashboard({ log: String(msg) });
}

function announceLeader() {
  for (const peer of peers.values()) {
    if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
      safeSend(peer.ws, {
        type: "leader-announce",
        data: {
          leaderId: NODE_ID,
          leaderUrl: PUBLIC_URL,
          priority: currentLeader.priority
        }
      });
    }
  }
}

function redirectToLeader(ws) {
  if (currentLeader && currentLeader.url && currentLeader.id !== NODE_ID) {
    safeSend(ws, {
      type: "redirect",
      data: currentLeader
    });
    return true;
  }

  safeSend(ws, {
    type: "error",
    message: "No hay líder disponible"
  });
  return false;
}

// --------------------------------------------
// 2) Leader Election & Failover
// --------------------------------------------

// Actualiza el líder en el clúster.
// Si el nodo no es líder, limpia estado de workers para evitar conflictos.
// Si es líder, anuncia su liderazgo a los backups y sincroniza estado.
function updateLeader(newLeader) {
  if (!newLeader || !newLeader.id) return;

  currentLeader = newLeader;
  isPrimary = currentLeader.id === NODE_ID;

  if (!isPrimary) {
    // Failover seguro: el backup no debe mantener workers locales antiguos
    workers.clear();
    taskQueue = [];
    log(`[${NODE_ID}] 🔄 Cambio de líder: ahora backup (${currentLeader.id}). Workers limpios.`);
  } else {
    log(`[${NODE_ID}] 🔄 Cambio de líder: ahora PRIMARY`);
    announceLeader();
  }

  pushState();

  if (isPrimary) {
    // Garantiza consistencia en el cluster
    syncToBackups(buildState());
  }
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
    currentLeader,
    totalServers: workers.size,
    activeServers,
    totalTimeouts,
    totalRegistrations,
    lastSyncAt,
    workers: getWorkerArray(),
    backups: getBackupArray(),
    tasks: Array.from(tasks.values())
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
    // 🤝 Handshake entre coordinadores

safeSend(ws, {
  type: "hello",
  data: {
    id: NODE_ID,
    url: PUBLIC_URL
  }
});
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
    log(`[${NODE_ID}] Conectado a backup: ${url}`);
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
  console.log("CAPS:", data.data?.capabilities);

  if (!isPrimary) {
    if (redirectToLeader(ws)) {
      log(`[${NODE_ID}] 🔀 Redirigiendo worker al líder ${currentLeader.id}`);
      return;
    }
  }

  let id = String(data.id || "").trim();
  const clientIp = ws._socket?.remoteAddress || "unknown";
const url = String(data.data?.url || clientIp).trim();
  // Si no viene ID, reutilizar por URL o generar uno
  if (!id) {
    const existingByUrl = Array.from(workers.values()).find(w => w.url === url);
    if (existingByUrl) {
      id = existingByUrl.id;
      console.log(`[${NODE_ID}] No ID enviado, reutilizando ID existente por URL: ${id}`);
    } else {
      id = "worker-" + Math.random().toString(36).substring(2, 9);
      console.log(`[${NODE_ID}] ID generado automáticamente: ${id}`);
    }
  }

  // Reutilizar por ID primero; si existe por URL y difiere, lo sincronizamos.
  let existingWorker = workers.get(id);
  if (!existingWorker) {
    existingWorker = Array.from(workers.values()).find(w => w.url === url);
  }

  // Eliminar posibles duplicados con mismo URL pero WS distinto (old stale sockets)
  for (const [wid, w] of workers.entries()) {
    if (w.url === url && w.ws !== ws) {
      workers.delete(wid);
    }
  }

  let isNewWorker = false;
  if (existingWorker) {
    // 🔁 reutilizar worker existente
    id = existingWorker.id;

    workers.set(id, {
      ...existingWorker,
      ws,
      lastPulse: now(),
      url,
      capabilities: data.data?.capabilities || existingWorker.capabilities || [],
      load: existingWorker.load || 0
    });

    log(`[${NODE_ID}] 🔁 Worker reconectado: ${id}`);
  } else {
    isNewWorker = true;
    const existing = workers.get(id);

    workers.set(id, {
      id,
      url,
      ws,
      lastPulse: now(),
      pulseCount: existing ? existing.pulseCount || 0 : 0,
      capabilities: data.data?.capabilities || [],
      load: 0
    });

    log(`[${NODE_ID}] 🆕 Worker nuevo: ${id}`);
  }

  if (isNewWorker) {
    totalRegistrations++;
  }

  safeSend(ws, {
    type: "register-ok",
    id,
    nodeId: NODE_ID,
    mode: isPrimary ? "PRIMARY" : "BACKUP",
    backups: getBackupArray()
  });

log(`[${NODE_ID}] Worker activo: ${id}`);
  pushState();
  assignQueuedTasks();
}



function handlePulse(data, ws) {
let id = String(data.data?.id || "").trim();
let worker = workers.get(id);

  // 🔥 Si no hay worker por ID, buscar por conexión (ws)
  if (!worker) {
    for (const w of workers.values()) {
      if (w.ws === ws) {
        worker = w;
        id = w.id;
        break;
      }
    }
  }

  // ❌ Si aún no existe, ignorar sin romper
 if (!worker) {
  return; // silencioso
}

  // ✅ actualizar datos
  worker.load = data.load ?? worker.load ?? 0;
  worker.lastPulse = now();
  worker.pulseCount = (worker.pulseCount || 0) + 1;
  worker.ws = ws;

  safeSend(ws, {
  type: "pulse-ok",
  data: {
    id,
    ts: new Date().toISOString()
  }
});

  pushState();
  assignQueuedTasks();
}
// FUNCIÓN PARA ELEGIR WORKER MEJOR 
// (ejemplo simple: el menos cargado que esté vivo y tenga la capacidad requerida) 

function selectBestWorker(taskType) {

  console.log("=================================");
  console.log("🔍 BUSCANDO WORKER PARA:", taskType);

  for (const w of workers.values()) {
    console.log("👨‍💻 Worker:", w.id, "| Caps:", w.capabilities);
  }

  const candidates = Array.from(workers.values())
    .filter(w =>
      now() - w.lastPulse <= TIMEOUT &&
      w.capabilities?.includes(taskType)
    )
    .sort((a, b) => (a.load || 0) - (b.load || 0));

  console.log("🎯 CANDIDATOS:", candidates.map(c => c.id));

  const selected = candidates[0] || null;

  console.log("✅ SELECCIONADO:", selected ? selected.id : "NINGUNO");
  console.log("=================================");

  return selected;
}

function ensureTaskHistoryLimit() {
  while (tasks.size > 50) {
    const oldest = tasks.keys().next().value;
    if (!oldest) break;
    tasks.delete(oldest);
    log(`[${NODE_ID}] 🗑️ Eliminando tarea antigua: ${oldest}`);
  }
}

function reassignTask(task) {
  if (!task || !task.id) return;
  task.retries = (task.retries || 0) + 1;

  if (task.retries >= 3) {
    task.status = "failed";
    log(`[${NODE_ID}] ❌ Tarea ${task.id} alcanzó max retries (${task.retries}).`);
    return;
  }

  const worker = selectBestWorker(task.type);
  if (!worker) {
    task.status = "queued";
    taskQueue.push(task);
    log(`[${NODE_ID}] 🔁 Tarea ${task.id} en cola por reintento ${task.retries}.`);
    return;
  }

  task.status = "assigned";
  task.workerId = worker.id;
  task.assignedAt = now();

  safeSend(worker.ws, {
    type: "task-assign",
    data: { taskId: task.id, type: task.type, payload: task.payload }
  });

  log(`[${NODE_ID}] 🔁 Tarea ${task.id} re-asignada a ${worker.id} (retry ${task.retries}).`);
}

// --------------------------------------------
// 3) Task Queue y Retry
// --------------------------------------------

// Asigna todas las tareas en espera a workers activos.
// Este módulo es fundamental para la disponibilidad (queue) y balanceo.
function assignQueuedTasks() {
  if (!isPrimary || taskQueue.length === 0) return;

  while (taskQueue.length > 0) {
    const nextTask = taskQueue[0];
    const worker = selectBestWorker(nextTask.type);

    if (!worker) break;

    taskQueue.shift();
    tasks.set(nextTask.id, {
      ...nextTask,
      status: "assigned",
      workerId: worker.id,
      assignedAt: now()
    });

    ensureTaskHistoryLimit();

    safeSend(worker.ws, {
      type: "task-assign",
      data: { taskId: nextTask.id, type: nextTask.type, payload: nextTask.payload }
    });

    log(`[${NODE_ID}] 🔁 Tarea en cola asignada: ${nextTask.id} -> ${worker.id}`);
  }

  if (taskQueue.length === 0) {
    pushState();
  }
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
  sendHello(ws);
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

case "hello":
  const { id, url } = data.data;

  console.log(`[${NODE_ID}] 🤝 HELLO de ${id}`);

  // guardar peer
 peers.set(url, {
  id,
  url,
  ws,
  lastSeen: Date.now()
});

  // responder welcome
  safeSend(ws, {
    type: "welcome",
    data: {
      id: NODE_ID,
      knownPeers: Array.from(peers.values()),
      leader: currentLeader
    }
  });

  break;

 case "welcome":
  const { knownPeers, leader } = data.data;

  console.log(`[${NODE_ID}] 📡 WELCOME recibido`);

  // guardar peers
  for (const p of knownPeers) {
    if (p.url !== PUBLIC_URL && !peers.has(p.url)) {
     const existing = peers.get(p.url);

     peers.set(p.url, {
  ...p,
  ws: existing?.ws || null,
  lastSeen: Date.now()
});

      // conectarse automáticamente 🔥
      connectToBackup(p.url);
    }
  }

  // aceptar líder si es mejor
  if (leader && leader.priority > currentLeader.priority) {
    updateLeader(leader);
  }

  break;

case "leader-announce":
  const incoming = data.data;

  if (incoming.priority > currentLeader.priority) {
    updateLeader({
      id: incoming.leaderId,
      url: incoming.leaderUrl,
      priority: incoming.priority
    });
  }

  break;
  case "task-assign":
  if (!isPrimary) {
    return safeSend(ws, {
      type: "redirect",
      data: currentLeader
    });
  }

  const { taskId, type, payload } = data.data;

  const worker = selectBestWorker(type);

  if (!worker) {
    // Cola de tareas (no hay worker disponible)
    const queuedTask = {
      id: taskId,
      type,
      payload,
      status: "queued",
      createdAt: Date.now(),
      retries: 0
    };

    taskQueue.push(queuedTask);
    tasks.set(taskId, queuedTask);
    ensureTaskHistoryLimit();

    log(`[${NODE_ID}] 🧾 Tarea en cola: ${taskId}`);

    return safeSend(ws, {
      type: "queued",
      data: { message: "Sin workers disponibles, tarea en cola" }
    });
  }

  // 🔥 guardar y asignar tarea
  tasks.set(taskId, {
    id: taskId,
    type,
    payload,
    status: "assigned",
    workerId: worker.id,
    createdAt: Date.now(),
    assignedAt: Date.now(),
    retries: 0
  });
  ensureTaskHistoryLimit();

  safeSend(worker.ws, {
    type: "task-assign",
    data: { taskId, type, payload }
  });

  log(`[${NODE_ID}] 🧠 Tarea enviada a ${worker.id}`);
  break;

case "task-result":
  const result = data.data;
  const task = tasks.get(result.taskId);

  if (task) {
    task.status = result.status;
    task.result = result.result || null;
    task.error = result.error || null;
    task.completedAt = Date.now();

    if (result.status === "error") {
      task.retries = (task.retries || 0) + 1;
      if (task.retries < 3) {
        reassignTask(task);
      } else {
        task.status = "failed";
        log(`[${NODE_ID}] 💀 Tarea ${task.id} falló definitivamente tras ${task.retries} intentos.`);
      }
    }

    ensureTaskHistoryLimit();
  }

  log(`[${NODE_ID}] ✅ Resultado tarea: ${result.taskId} (${result.status})`);
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
            workers = new Map(
              (incoming.workers || []).map((w) => [
                w.id,
                { ...w, ws: null, inherited: true }
              ])
            );
            backups = new Map((incoming.backups || []).map((b) => [b.url, b]));
            tasks = new Map((incoming.tasks || []).map((t) => [t.id, t]));
            totalTimeouts = incoming.totalTimeouts || 0;
            totalRegistrations = incoming.totalRegistrations || totalRegistrations;
            lastSyncAt = new Date().toISOString();
            safeSend(ws, { type: "sync_ack", nodeId: NODE_ID });
            pushState();
          }
          break;

          case "coordinator_hello":
  console.log(`[${NODE_ID}] 🤝 Conectado a coordinador ${data.nodeId}`);

  if (data.isPrimary) {
    currentPrimaryId = data.nodeId;
    lastPrimaryPulse = Date.now();
  }
  break;

case "primary_heartbeat":
  if (!isPrimary) {
    lastPrimaryPulse = Date.now();
    currentPrimaryId = data.nodeId;
  }
  break;
  
  case "ping":
  safeSend(ws, {
    type: "pong",
    data: { message: "pong" }
  });
  break;

case "pong":
  for (const peer of peers.values()) {
    if (peer.ws === ws) {
      peer.lastSeen = Date.now();
    }
  }
  break;

        default:
          break;

      }
    } catch {}
  });

  ws.on("close", () => {
    dashboardClients.delete(ws);

   for (const [id, worker] of workers.entries()) {
  // 🔥 solo borrar si este nodo es el dueño real del worker
  if (worker.ws === ws && worker.ws !== null) {
    workers.delete(id);
  }
}
    pushState();
  });
});





const heartbeatTimer = setInterval(() => {
  const t = now();

 if (isPrimary) {
  for (const [id, worker] of workers.entries()) {

    // 🔥 GRACE PERIOD después de failover
    if (becamePrimaryAt && (t - becamePrimaryAt < FAILOVER_GRACE)) {
      continue; // no borrar todavía
    }

    if (t - worker.lastPulse > TIMEOUT) {
      workers.delete(id);
      totalTimeouts++;
      log(`[${NODE_ID}] Timeout worker: ${id}`);
    }
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

// ================= FAILOVER AUTOMÁTICO =================
setInterval(() => {
  const nowTime = Date.now();

  if (currentLeader.id !== NODE_ID) {
    const leaderPeer = Array.from(peers.values()).find(
      p => p.id === currentLeader.id
    );

    if (!leaderPeer || nowTime - leaderPeer.lastSeen > 5000) {
      log("🚨 líder caído → nueva elección");

      currentLeader = {
        id: NODE_ID,
        url: PUBLIC_URL,
priority: MY_PRIORITY      };

      isPrimary = true;
      announceLeader();
    }
  }
}, 3000);

const backupSyncTimer = setInterval(() => {
  if (isPrimary) {
    pushState();
  }
}, SYNC_INTERVAL);

// ================= HEARTBEAT ENTRE COORDINADORES =================
setInterval(() => {
  for (const peer of peers.values()) {
    if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
      safeSend(peer.ws, {
        type: "ping",
        data: { message: "ping" }
      });
    }
  }
}, 2000);

setInterval(() => {
  const nowTime = Date.now();

  for (const [url, peer] of peers.entries()) {
    if (nowTime - peer.lastSeen > 8000) {
      console.log(`[${NODE_ID}] ❌ Peer caído: ${peer.id}`);
      peers.delete(url);
    }
  }
}, 4000);

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
