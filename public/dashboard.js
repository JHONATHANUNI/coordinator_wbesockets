class CoordinatorDashboard {
  constructor() {
    this.ws = null;
    this.TIMEOUT = 20000;
    this.reconnectDelay = 2000;
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
    const {
      totalServers,
      activeServers,
      totalTimeouts,
      backups,
      workers,
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
    this.setText("timestamp", timestamp || "-");

    this.renderBackups(backups || []);
    this.renderWorkers(workers || []);
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

    if (!workers.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-row">No hay workers registrados</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = workers
      .map((w) => {
        const status = this.getWorkerStatus(w);
        return `
          <tr>
            <td title="${this.escapeHtml(w.id)}">${this.shortId(w.id)}</td>
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

    const input = document.getElementById("backupUrl");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.registerBackup();
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
