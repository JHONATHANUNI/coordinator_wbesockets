const express = require("express")
const cors = require("cors")

const app = express()
const PORT = 3000

// Aumentado para evitar falsos fallos por latencia/ngrok
const TIMEOUT = 20000

app.use(cors())
const path = require("path")
app.use(express.json())

// Servir dashboard
app.use(express.static(path.join(__dirname, "public")))

let servers = {}
let totalTimeouts = 0

// ================= REGISTRO =================
app.post("/register", (req, res) => {

    const {id, url} = req.body

    if(!id || !url){
        return res.status(400).json({ error: "Se requiere id y url" })
    }

    servers[id] = {
        id,
        url,
        lastPulse: Date.now()
    }

    console.log(`Servidor registrado: ${id} - ${url}`)
    res.json({ message: "registrado"})
})

// ================= HEARTBEAT =================
app.post("/pulse", (req, res) => {
    const {id} = req.body

    if(!servers[id]){
        return res.status(400).json({ error: "no se encuentra server" })
    }

    servers[id].lastPulse = Date.now()
    res.json({ message: "pulso recibido"})
})

// ================= LISTA SERVERS =================
app.get("/servers", (req, res) => {
    res.json(servers)
})

// ================= METRICAS =================
app.get("/metrics", (req, res) => {
    res.json({
        totalServers: Object.keys(servers).length,
        totalTimeouts
    })
})

// ================= DETECTOR DE FALLOS =================
setInterval(() => {
    const now = Date.now()

    for (let id in servers) {

        if (now - servers[id].lastPulse > TIMEOUT) {
            console.log(`Servidor caído eliminado: ${id}`)
            delete servers[id]
            totalTimeouts++
        }

    }

}, 5000)

// ================= START =================
app.listen(PORT, () => {
    console.log(`Coordinator corriendo en ${PORT}`)
})