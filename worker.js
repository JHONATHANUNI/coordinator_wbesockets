const WebSocket = require('ws');

// Configuración del worker (configurable via args o env)
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).substr(2, 9)}`;
const COORDINATOR_URLS = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : (process.env.COORDINATOR_URLS ? process.env.COORDINATOR_URLS.split(',') : [
        'wss://tu-ngrok-url.ngrok.io',  // Cambia por tu URL de ngrok
        'wss://backup-ngrok-url.ngrok.io'  // URL de backup si tienes
    ]);

let currentCoordinator = null;
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// --------------------------------------------
// Worker: Comunicación con Coordinador
// --------------------------------------------
// Conecta a un coordinador, maneja eventos de socket y registro.
function connectToCoordinator(url) {
    console.log(`🔗 Conectando a ${url} como ${WORKER_ID}...`);
    ws = new WebSocket(url);

    ws.on('open', () => {
        console.log(`✅ Conectado a ${url}`);
        currentCoordinator = url;
        reconnectAttempts = 0;

        // Registrar como worker
        ws.send(JSON.stringify({
            type: 'register',
            data: {
                id: WORKER_ID,
                url: 'worker-local',
                capabilities: ['test', 'math_compute']
            }
        }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleMessage(msg);
        } catch (err) {
            console.error('❌ Error parseando mensaje:', err);
        }
    });

    ws.on('close', () => {
        console.log(`🔌 Desconectado de ${url}`);
        currentCoordinator = null;
        attemptReconnect();
    });

    ws.on('error', (err) => {
        console.error(`❌ Error en conexión ${url}:`, err);
        attemptReconnect();
    });
}

// --------------------------------------------
// Worker: Manejo de mensajes entrantes
// --------------------------------------------
function handleMessage(msg) {
    console.log(`📨 Mensaje recibido:`, msg.type);

    switch (msg.type) {
        case 'redirect':
            console.log(`🔄 Redirigiendo a ${msg.data.url}`);
            if (ws) ws.close();
            setTimeout(() => connectToCoordinator(msg.data.url), 1000);
            break;

        case 'task-assign':
            const { taskId, type, payload } = msg.data;
            console.log(`🎯 Tarea asignada: ${taskId} tipo ${type}`);
            processTask({ id: taskId, type, payload });
            break;

        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', data: { id: WORKER_ID } }));
            break;

        default:
            console.log(`❓ Mensaje desconocido:`, msg);
    }
}

// --------------------------------------------
// Worker: Ejecución de tarea
// --------------------------------------------
// Simula ejecución con duración aleatoria y envía task-result.
function processTask(task) {
    console.log(`⚙️ Procesando tarea ${task.id}...`);

    // Simular tiempo de procesamiento (1-5 segundos)
    const duration = Math.random() * 4000 + 1000;

    setTimeout(() => {
        const success = Math.random() > 0.1; // 90% éxito

        if (success) {
            console.log(`✅ Tarea ${task.id} completada`);
            ws.send(JSON.stringify({
                type: 'task-result',
                data: {
                    taskId: task.id,
                    status: 'ok',
                    result: `Resultado de tarea ${task.type}`,
                    completedAt: Date.now()
                }
            }));
        } else {
            console.log(`❌ Tarea ${task.id} falló`);
            ws.send(JSON.stringify({
                type: 'task-result',
                data: {
                    taskId: task.id,
                    status: 'error',
                    error: 'Error simulado',
                    completedAt: Date.now()
                }
            }));
        }
    }, duration);
}

// Intentar reconectar inteligentemente
function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('🚫 Máximo de intentos de reconexión alcanzado');
        return;
    }

    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff

    console.log(`🔄 Intentando reconectar en ${delay}ms (intento ${reconnectAttempts})`);

    setTimeout(() => {
        // Intentar el siguiente coordinador en la lista
        const nextIndex = COORDINATOR_URLS.indexOf(currentCoordinator) + 1;
        const nextUrl = COORDINATOR_URLS[nextIndex % COORDINATOR_URLS.length];
        connectToCoordinator(nextUrl);
    }, delay);
}

// Iniciar conexión
console.log(`🚀 Iniciando worker ${WORKER_ID}`);
connectToCoordinator(COORDINATOR_URLS[0]);

// Heartbeat cada 2 segundos (CRÍTICO para que el coordinador sepa que estamos vivos)
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'pulse',
            data: {
                id: WORKER_ID,
                load: Math.floor(Math.random() * 10) // carga simulada 0-9
            }
        }));
    }
}, 2000);

// Mantener vivo el proceso
process.on('SIGINT', () => {
    console.log('🛑 Deteniendo worker...');
    if (ws) ws.close();
    process.exit(0);
});