async function updateDashboard(){
    try{
        const servers = await fetch('/servers').then(r=>r.json());
        const metrics = await fetch('/metrics').then(r=>r.json());

        const tbody = document.querySelector("#serversTable tbody");
        tbody.innerHTML="";

        const now = Date.now();

        for(const id in servers){
            const s = servers[id];

            const diff = now - s.lastPulse;
            const status = diff < 5000 ? "Activo" : "Activo"; 

            const row = `
            <tr>
                <td>${s.id}</td>
                <td><a href="${s.url}" target="_blank">${s.url}</a></td>
                <td>${diff} ms</td>
                <td class="active">${status}</td>
            </tr>`;

            tbody.innerHTML += row;
        }

        document.getElementById("metrics").innerHTML = `
        <h3>📊 Métricas</h3>
        <p>Número total de servidores rastreados: ${metrics.totalServers}</p>
        <p>Número actual de servidores activos: ${Object.keys(servers).length}</p>
        <p>Total de timeouts detectados: ${metrics.totalTimeouts}</p>
        <p>Timestamp actual del coordinator: ${new Date().toLocaleString()}</p>`;

    }catch(error){
        document.getElementById("metrics").innerHTML =
        "<h3 style='color:red'>Error: el coordinator no responde (tolerancia a fallos)</h3>";
    }
}


setInterval(updateDashboard,2000);
updateDashboard();
