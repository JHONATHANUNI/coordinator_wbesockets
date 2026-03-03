async function updateDashboard() {
    try {
        const response = await fetch('/status');
        const data = await response.json();

        const { workers, backups, isPrimary, metrics } = data;

        const tbody = document.querySelector("#serversTable tbody");
        tbody.innerHTML = "";

        const now = Date.now();
        let activeCount = 0;

        const TIMEOUT = 20000; // Debe coincidir con backend

        const workerIds = Object.keys(workers);

        if (workerIds.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;">
                        No hay workers registrados
                    </td>
                </tr>`;
        }

        workerIds.forEach(id => {
            const s = workers[id];

            const diff = now - s.lastPulse;
            const isActive = diff < TIMEOUT;

            if (isActive) activeCount++;

            const status = isActive ? "Activo" : "Inactivo";
            const statusClass = isActive ? "active" : "inactive";

            const row = `
                <tr>
                    <td>${s.id}</td>
                    <td><a href="${s.url}" target="_blank">${s.url}</a></td>
                    <td>${diff} ms</td>
                    <td class="${statusClass}">${status}</td>
                </tr>`;

            tbody.innerHTML += row;
        });

        const backupsList = backups.length > 0
            ? backups.map(b => `<li>${b}</li>`).join("")
            : "<li>No hay backups registrados</li>";

        const primaryStatus = document.getElementById("primaryStatus");

        if (isPrimary) {
            primaryStatus.textContent = "Coordinador Primario";
            primaryStatus.className = "primary-indicator primary glow";
        } else {
            primaryStatus.textContent = "Coordinador Backup";
            primaryStatus.className = "primary-indicator backup";
        }

        document.getElementById("metrics").innerHTML = `
            <h3>📊 Métricas del Sistema</h3>
            <p>Total de workers registrados: ${workerIds.length}</p>
            <p>Workers activos: ${activeCount}</p>
            <p>Total de backups conocidos: ${backups.length}</p>
            <p>Total de timeouts detectados: ${metrics.totalTimeouts || 0}</p>
            <p>Timestamp actual: ${new Date().toLocaleString()}</p>
            <h4>🔁 Coordinadores Backup</h4>
            <ul>${backupsList}</ul>
        `;

    } catch (error) {
        document.getElementById("metrics").innerHTML = `
            <h3 style='color:red'>
                ⚠ Error: El coordinator no responde (modo tolerancia a fallos)
            </h3>`;
    }
}

/* ============================= */
/* REGISTRAR BACKUP */
/* ============================= */
async function registerBackup() {
    const input = document.getElementById("backupInput");
    const url = input.value.trim();

    if (!url) {
        alert("Ingresa una URL válida");
        return;
    }

    try {
        const res = await fetch('/register-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "Error registrando backup");
        }

        input.value = "";
        updateDashboard();

    } catch (err) {
        alert("Error registrando backup");
    }
}

/* ============================= */
/* FORZAR SINCRONIZACIÓN */
/* ============================= */
async function forceSync() {
    try {
        await fetch('/sync-workers');
        alert("Sincronización manual ejecutada");
    } catch (err) {
        alert("Error forzando sincronización");
    }
}

/* ============================= */
/* AUTO REFRESH */
/* ============================= */
setInterval(updateDashboard, 2000);
updateDashboard();