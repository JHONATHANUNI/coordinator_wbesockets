const express = require("express")
const cors = require("cors")
const path = require("path")

const app = express()
const PORT = 3000
const TIMEOUT = 20000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

let servers = {}
let totalTimeouts = 0
let backups = []
let isPrimary = true

/* ================================================= */
/* ================= REGISTRO WORKER ================ */
/* ================================================= */
app.post("/register", (req, res) => {

    const { id, url } = req.body

    if (!id || !url) {
        return res.status(400).json({ error: "Se requiere id y url" })
    }

    servers[id] = {
        id,
        url,
        lastPulse: Date.now(),
        registeredAt: Date.now()
    }

    console.log(`Worker registrado: ${id}`)

    // Replicación NO bloqueante
    replicateToBackups()

    res.json({ message: "registrado" })
})

/* ================================================= */
/* ================= HEARTBEAT ====================== */
/* ================================================= */
app.post("/pulse", (req, res) => {

    const { id } = req.body

    if (!servers[id]) {
        return res.status(400).json({ error: "Worker no encontrado" })
    }

    servers[id].lastPulse = Date.now()

    // Replicación NO bloqueante
    replicateToBackups()

    res.json({ message: "pulso recibido" })
})

/* ================================================= */
/* ================= STATUS ========================= */
/* ================================================= */
app.get("/status", (req, res) => {
    res.json({
        workers: servers,
        backups,
        isPrimary,
        metrics: {
            totalTimeouts
        }
    })
})

/* ================================================= */
/* ================= REGISTRO BACKUP ================ */
/* ================================================= */
app.post("/register-backup", (req, res) => {

    const { url } = req.body

    if (!url) {
        return res.status(400).json({ error: "URL requerida" })
    }

    if (!backups.includes(url)) {
        backups.push(url)
        console.log(`Backup agregado: ${url}`)
    }

    res.json({ message: "Backup registrado", backups })
})

/* ================================================= */
/* ================= SYNC WORKERS =================== */
/* ================================================= */
app.get("/sync-workers", (req, res) => {
    res.json(Object.values(servers))
})

/* ================================================= */
/* ================= REPLICATE ====================== */
/* ================================================= */
app.post("/replicate", (req, res) => {

    const { workers, totalTimeouts: timeoutsFromPrimary } = req.body

    if (!workers) {
        return res.status(400).json({ error: "Workers requeridos" })
    }

    // Reemplazar completamente el estado (consistencia fuerte)
    servers = {}

    workers.forEach(w => {
        servers[w.id] = w
    })

    if (timeoutsFromPrimary !== undefined) {
        totalTimeouts = timeoutsFromPrimary
    }

    console.log("Estado sincronizado desde primario")

    res.json({ message: "Replicación recibida" })
})

/* ================================================= */
/* ========= REPLICACIÓN AUTOMÁTICA (NO BLOQUEANTE) */
/* ================================================= */
function replicateToBackups() {

    if (!isPrimary) return

    const workersArray = Object.values(servers)

    backups.forEach(backupUrl => {

        fetch(`${backupUrl}/replicate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                workers: workersArray,
                totalTimeouts
            })
        })
        .then(() => {
            console.log(`Replicado a ${backupUrl}`)
        })
        .catch(() => {
            console.log(`No se pudo replicar a ${backupUrl}`)
        })

    })
}

/* ================================================= */
/* ================= DETECTOR DE FALLOS ============ */
/* ================================================= */
setInterval(() => {

    const now = Date.now()
    let removed = false

    for (let id in servers) {

        if (now - servers[id].lastPulse > TIMEOUT) {

            console.log(`Worker eliminado por timeout: ${id}`)

            delete servers[id]
            totalTimeouts++
            removed = true
        }
    }

    // Si hubo cambios, replicar
    if (removed) {
        replicateToBackups()
    }

}, 5000)

/* ================================================= */
/* ================= START ========================== */
/* ================================================= */
app.listen(PORT, () => {
    console.log(`Coordinator corriendo en ${PORT}`)
})