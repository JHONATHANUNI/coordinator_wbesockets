const TIMEOUT = 20000;
let previousServers = {};

async function updateDashboard() {
  try {
    const servers = await fetch("/servers").then((r) => r.json());
    const metrics = await fetch("/metrics").then((r) => r.json());
    const backups = await fetch("/backups").then((r) => r.json());
    const modeData = await fetch("/mode").then((r) => r.json());

    const tbody = document.getElementById("serversTable");
    tbody.innerHTML = "";

    const now = Date.now();
    let activeCount = 0;

    for (const id in servers) {
      const s = servers[id];
      const diff = now - s.lastPulse;

      let statusText = "Activo";
      let statusClass = "status-active";

      if (diff > TIMEOUT) {
        statusText = "Timeout";
        statusClass = "status-dead";
      } else if (diff > TIMEOUT * 0.6) {
        statusText = "Inestable";
        statusClass = "status-warning";
        activeCount++;
      } else {
        activeCount++;
      }

      const originBadge =
        s.origin === "replicated"
          ? `<span style="color:#4da6ff; font-weight:bold;">🌐 Replicado</span>`
          : `<span style="color:#00cc88; font-weight:bold;">🏠 Local</span>`;

      const row = `
        <tr class="${s.origin === "replicated" ? "replicated-row" : ""}">
          <td>${s.id}</td>
          <td><a href="${s.url}" target="_blank">${s.url}</a></td>
          <td>${diff} ms</td>
          <td>${s.pulseCount || 0}</td>
          <td class="${statusClass}">
            <span class="pulse-dot" id="dot-${s.id}"></span>
            ${statusText}<br>${originBadge}
          </td>
        </tr>`;

      tbody.innerHTML += row;

      // Pulso
      if (
        previousServers[id] &&
        (s.pulseCount || 0) > (previousServers[id].pulseCount || 0)
      ) {
        setTimeout(() => {
          const dot = document.getElementById(`dot-${s.id}`);
          if (dot) {
            dot.classList.add("pulse-animate");
            setTimeout(() => dot.classList.remove("pulse-animate"), 400);
          }
        }, 50);
      }
    }

    previousServers = JSON.parse(JSON.stringify(servers));

    document.getElementById("totalServers").textContent = metrics.totalServers;
    document.getElementById("totalBackups").textContent = backups.length;
    document.getElementById("mode").textContent = modeData.mode;
    document.getElementById("activeServers").textContent = activeCount;
    document.getElementById("totalTimeouts").textContent = metrics.totalTimeouts;
    document.getElementById("timestamp").textContent =
      new Date().toLocaleTimeString();

    const backupList = document.getElementById("backupList");
    if (backupList) {
      backupList.innerHTML = "";
      backups.forEach((b) => {
        backupList.innerHTML += `<li style="margin-bottom:6px;">🔗 ${b}</li>`;
      });
    }

    document.getElementById("mode").style.color =
      modeData.mode === "PRIMARY" ? "#00cc88" : "#4da6ff";
  } catch (error) {
    console.error("Error cargando dashboard:", error);
    document.getElementById("mode").textContent = "SIN CONEXIÓN";
    document.getElementById("mode").style.color = "red";
  }
}

async function registerBackup() {
  const input = document.getElementById("backupUrl");
  const url = input.value.trim();

  if (!url) {
    alert("⚠ Debes ingresar una URL de backup");
    return;
  }

  try {
    const response = await fetch("/register-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert("❌ Error: " + (data.error || "No se pudo registrar"));
      return;
    }

    alert("✅ Backup registrado correctamente");
    input.value = "";
    updateDashboard();
  } catch (err) {
    alert("❌ No se pudo conectar con el coordinator");
    console.error(err);
  }
}

async function forceSync() {
  try {
    const response = await fetch("/force-sync", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      alert("❌ Error: " + (data.error || "No se pudo sincronizar"));
      return;
    }

    alert("🔄 Sincronización completada");
    updateDashboard();
  } catch (err) {
    alert("❌ El coordinator no responde");
    console.error(err);
  }
}

setInterval(updateDashboard, 2000);
updateDashboard();