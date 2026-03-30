class CoordinatorDashboard {
  constructor() {
    this.ws = null;
    this.TIMEOUT = 20000;
    this.reconnectDelay = 2000;
    this.workerFilter = "all";
    this.taskFilter = "all";
    this.searchQuery = "";
    this.latestData = null;
    this.init();
  }

  init() {
    this.connectWebSocket();
    this.bindEvents();
  }

  connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      document.body.classList.add("connected");
      this.ws.send(JSON.stringify({ type: "dashboard_connect" }));
      this.flushStatus("Conectado");
    };

    this.ws.onmessage = (event) => this.handleMessage(event);

    this.ws.onclose = () => {
      document.body.classList.remove("connected");
      this.flushStatus("Reconectando...");
      setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
    };

    this.ws.onerror = () => {
      this.flushStatus("Error de conexión");
    };
  }

  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "dashboard_update") {
        this.render(data);
      }
    } catch (e) {
      console.error("Mensaje inválido", e);
    }
  }

  render(data) {
    this.latestData = data;

    const {
      totalServers,
      activeServers,
      totalTimeouts,
      backups,
      workers,
      tasks,
      mode,
      timestamp,
      nodeId,
      totalRegistrations
    } = data;

    this.updateMetric("totalServers", totalServers ?? 0);
    this.updateMetric("activeServers", activeServers ?? 0);
    this.updateMetric("totalTimeouts", totalTimeouts ?? 0);
    this.updateMetric("totalBackups", backups?.length ?? 0);
    this.updateMetric("totalRegistrations", totalRegistrations ?? 0);

    this.setText("mode", mode || "-");
    this.setText("nodeId", nodeId || "-");
    this.setText("leaderId", data.currentLeader?.id || "-");
    this.setText("timestamp", timestamp || "-");

    this.renderBackups(backups || []);
    this.renderWorkers(workers || []);
    this.renderTasks(data.tasks || []);
    this.renderTopology(data);
    this.renderLogs(data.log);
  }

  getTaskClass(status) {
    if (status === "ok") return "live";
    if (status === "error") return "dead";
    if (status === "assigned") return "unstable";
    if (status === "running") return "online";
    if (status === "queued") return "unstable";
    return "";
  }

  renderTasks(tasks) {
    const tbody = document.getElementById("tasksTable");
    if (!tbody) return;

    if (!tasks.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-row">No hay tareas asignadas</td>
        </tr>
      `;
      return;
    }

    let filtered = Array.from(tasks || []);
    if (this.taskFilter === "error") {
      filtered = filtered.filter((task) => task.status === "error");
    }

    tbody.innerHTML = filtered
      .map((task) => {
        const status = task.status || "-";
        const statusClass = this.getTaskClass(status);

        const duration =
          typeof task.completedAt === "number" && typeof task.createdAt === "number"
            ? `${task.completedAt - task.createdAt}ms`
            : "-";

        return `
        <tr class="fade-in">
          <td title="${this.escapeHtml(task.id)}">${this.shortId(task.id)}</td>
          <td>${this.escapeHtml(task.type || "-")}</td>
          <td>${this.escapeHtml(task.workerId || "-")}</td>
          <td><span class="status ${statusClass}">${this.escapeHtml(status)}</span></td>
          <td>${this.escapeHtml(duration)}</td>
        </tr>
      `;
      })
      .join("");
  }

  renderTopology(data) {
    const container = document.getElementById("topologyContainer");
    if (!container) return;

    const leader = data.currentLeader || { id: "-" };
    const backups = data.backups || [];
    const workers = data.workers || [];

    const backupList = backups
      .map((b) => `<div class="topology-node">Coordinator ${this.escapeHtml(b.id || b.url || "?")}</div>`)
      .join("<div class='topology-edge'>↕</div>");

    const workerList = workers
      .map((w) => `<div class="topology-node">Worker ${this.escapeHtml(w.id || "?")}</div>`)
      .join("");

    container.innerHTML = `
      <div class="topology-node">Coordinator ${this.escapeHtml(leader.id)} (Leader)</div>
      <div class="topology-edge">↕</div>
      <div class="topology-sublist">
        ${backupList || '<div class="topology-node">Coordinator B (no backups)</div>'}
      </div>
      <div class="topology-edge">↕</div>
      <div class="topology-sublist">
        ${workerList || '<div class="topology-node">No workers</div>'}
      </div>
    `;
  }
  filterWorkers(filter) {
    this.workerFilter = filter;
    this.renderWorkers(this.latestData?.workers || []);
  }

  filterTasks(filter) {
    this.taskFilter = filter;
    this.renderTasks(this.latestData?.tasks || []);
  }

  sendTestTask() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.flushStatus('No conectado, no se pudo enviar task');
      return;
    }

    const taskId = `test-${Date.now()}`;
    const msg = {
      type: 'task-assign',
      data: {
        taskId,
        type: 'test',
        payload: { source: 'dashboard', random: Math.random().toString(36).slice(2) }
      }
    };

    this.ws.send(JSON.stringify(msg));
    this.flushStatus(`Test task enviada: ${taskId}`);
  }
  renderLogs(message) {
    const container = document.getElementById("logs");
    if (!container) return;
    if (!message) return;

    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.textContent = `${new Date().toLocaleTimeString()} - ${message}`;

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  updateMetric(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    el.style.transform = "scale(1.08)";
    setTimeout(() => (el.style.transform = "scale(1)"), 180);
  }

  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  renderBackups(backups) {
    const container = document.getElementById("backupList");
    if (!container) return;

    if (!backups.length) {
      container.innerHTML = `<div class="empty-state">Sin backups registrados</div>`;
      return;
    }

    container.innerHTML = backups
      .map(
        (b) => `
        <div class="backup-item ${b.connected ? "online" : "offline"}">
          <div class="backup-title">
            <span class="dot ${b.connected ? "green" : "red"}"></span>
            <strong>${this.escapeHtml(b.url)}</strong>
          </div>
          <div class="backup-meta">
            Estado: ${b.connected ? "Conectado" : "Desconectado"} · Última señal: ${this.formatAgo(b.lastSeen)}
          </div>
        </div>
      `
      )
      .join("");
  }

  renderWorkers(workers) {
    const tbody = document.getElementById("serversTable");
    if (!tbody) return;

    let filtered = Array.from(workers || []);

    if (this.workerFilter === "active") {
      filtered = filtered.filter((w) => this.getWorkerStatus(w).label === "Activo");
    } else if (this.workerFilter === "down") {
      filtered = filtered.filter((w) => this.getWorkerStatus(w).label === "Muerto");
    } else if (this.workerFilter === "leader") {
      filtered = filtered.filter((w) => w.id === this.latestData?.currentLeader?.id);
    }

    if (this.searchQuery && this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      filtered = filtered.filter((w) => (w.id || "").toLowerCase().includes(q) || (w.url || "").toLowerCase().includes(q));
    }

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-row">No hay workers registrados</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered
      .map((w) => {
        const status = this.getWorkerStatus(w);
        let role = "";
        if (w.id === this.latestData?.currentLeader?.id) {
          role = " 👑";
        }
        return `
          <tr>
            <td title="${this.escapeHtml(w.id)}">${this.shortId(w.id)}${role}</td>
            <td>${this.escapeHtml(w.url || "-")}</td>
            <td>${this.formatAgo(w.lastPulse)}</td>
            <td>${w.pulseCount || 0}</td>
            <td><span class="status ${status.cls}">${status.label}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  getWorkerStatus(worker) {
    const diff = Date.now() - Number(worker.lastPulse || 0);
    if (diff > this.TIMEOUT) return { cls: "dead", label: "Muerto" };
    if (diff > this.TIMEOUT * 0.7) return { cls: "unstable", label: "Inestable" };
    return { cls: "live", label: "Activo" };
  }

  formatAgo(ts) {
    const n = Number(ts || 0);
    if (!n) return "-";
    const s = Math.max(0, Math.floor((Date.now() - n) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  shortId(id) {
    const s = String(id || "");
    return s.length > 12 ? `${s.slice(0, 12)}…` : s;
  }

  registerBackup() {
    const input = document.getElementById("backupUrl");
    if (!input || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const url = input.value.trim();
    if (!url) return;

    this.ws.send(JSON.stringify({ type: "register_backup", url }));
    input.value = "";
  }

  forceSync() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "force_sync" }));
    }
  }

  bindEvents() {
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        this.forceSync();
      }
    });

    const backupInput = document.getElementById("backupUrl");
    if (backupInput) {
      backupInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.registerBackup();
      });
    }

    const workerSearch = document.getElementById("workerSearch");
    if (workerSearch) {
      workerSearch.addEventListener("input", (e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.renderWorkers(this.latestData?.workers || []);
      });
    }
  }

  flushStatus(text) {
    const el = document.getElementById("connectionStatus");
    if (el) el.textContent = text;
  }

  escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.dashboard = new CoordinatorDashboard();
});
