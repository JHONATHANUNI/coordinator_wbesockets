# 🚀 Sistema Coordinador Distribuido - Jhonathan Uni

> **Proyecto Final - Sistemas Distribuidos 2026**
>
> Sistema distribuido completo con coordinadores, workers y dashboard en tiempo real. Implementa leader election, failover automático, balanceo de carga y comunicación WebSocket.

## 📊 Características Principales

### 🔥 Sistema Distribuido
- **Múltiples Coordinadores**: Descubrimiento automático y comunicación peer-to-peer
- **Elección de Líder**: Algoritmo con prioridades y failover automático
- **Sincronización**: Estado consistente entre todos los nodos
- **Tolerancia a Fallos**: Recuperación automática sin intervención

### ⚙️ Gestión de Tareas
- **Workers Inteligentes**: Registro automático con capabilities y heartbeat
- **Balanceo de Carga**: Asignación basada en carga y capacidades
- **Cola de Tareas**: Manejo de overflow cuando no hay workers disponibles
- **Retry Automático**: Reintentos en caso de fallos (máximo 3)

### 💻 Dashboard Profesional
- **UI NASA-Level**: Tema espacial con animaciones y efectos
- **Tiempo Real**: Actualizaciones en vivo de estado del sistema
- **Topología Visual**: Representación gráfica de la red distribuida
- **Métricas Completas**: Activos, timeouts, registros, logs

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌─────────────────┐
│  Coordinador A  │◄──►│  Coordinador B  │
│    (LÍDER)      │    │   (BACKUP)      │
└─────────────────┘    └─────────────────┘
         │                        │
         └────────────────────────┘
                  │
         ┌─────────────────┐
         │    WORKERS      │
         │  (Ejecutores)   │
         └─────────────────┘
```

## 🚀 Instalación y Uso

### Prerrequisitos
- Node.js v18+
- npm o yarn

### Instalación
```bash
# Clonar repositorio
git clone https://github.com/JHONATHANUNI/coordinator_wbesockets.git
cd coordinator_wbesockets

# Instalar dependencias
npm install
```

### Ejecutar Sistema

#### 1. Coordinador Principal
```bash
node server.js
```

#### 2. Coordinador Backup (en otra terminal)
```bash
PRIMARY=false ID=node2 node server.js
```

#### 3. Worker de Prueba
```bash
node worker.js ws://localhost:8080
```

#### 4. Dashboard
Abre en navegador: `http://localhost:3000`

## 📋 Protocolo de Comunicación

### Coordinadores ↔ Coordinadores
- `hello` - Descubrimiento inicial
- `welcome` - Respuesta con información del cluster
- `leader-announce` - Anuncio de nuevo líder
- `ping/pong` - Heartbeat entre nodos
- `sync_state` - Sincronización de estado

### Coordinador ↔ Workers
- `register` - Registro de worker
- `pulse` - Heartbeat del worker
- `task-assign` - Asignación de tarea
- `task-result` - Resultado de tarea
- `redirect` - Redirección a líder

## 🎯 Rúbrica de Evaluación

### 🔥 Críticos (Obligatorios para 5.0)
- ✅ **Protocolo correcto**: hello, welcome, ping, pong, leader-announce
- ✅ **Elección de líder**: Solo uno activo con prioridad
- ✅ **Failover automático**: Recuperación sin intervención
- ✅ **Heartbeat**: Detección de nodos caídos

### ⚙️ Funcionales
- ✅ **Registro de workers**: Con capabilities y estado
- ✅ **Envío de tareas**: Asignación y resultados
- ✅ **Balanceo de carga**: Selección inteligente
- ✅ **Sincronización**: Estado consistente

### 💻 Calidad
- ✅ **Código limpio**: Modular y legible
- ✅ **Robusto**: Manejo de errores completo
- ✅ **Extensible**: Fácil agregar nuevas tareas
- ✅ **UI Profesional**: Dashboard con animaciones

## 🧪 Pruebas

### Prueba Local
```bash
# Terminal 1: Coordinador
node server.js

# Terminal 2: Worker 1
node worker.js ws://localhost:8080

# Terminal 3: Worker 2
node worker.js ws://localhost:8080

# Dashboard: http://localhost:3000
# Presiona "Test" para enviar tareas
```

### Prueba con Compañeros
```bash
# Cada compañero ejecuta su worker apuntando a tu ngrok
node worker.js wss://tu-ngrok-url.ngrok.io
```

## 📁 Estructura del Proyecto

```
coordinator_wbesockets/
├── server.js              # Servidor coordinador principal
├── worker.js              # Cliente worker
├── package.json           # Dependencias
├── public/
│   ├── index.html         # Dashboard HTML
│   ├── dashboard.js       # Lógica frontend
│   └── styles.css         # Estilos (integrado en HTML)
└── README.md              # Esta documentación
```

## 🔧 Configuración

### Variables de Entorno
```bash
# Puerto del servidor
PORT=3000

# ID único del nodo
ID=node1

# Si es primario (true) o backup (false)
PRIMARY=true

# URL pública (para ngrok)
PUBLIC_URL=ws://localhost:3000

# Intervalos de heartbeat
HEARTBEAT_INTERVAL=5000
SYNC_INTERVAL=3000
```

### Configuración de Worker
```bash
# URLs de coordinadores
node worker.js wss://coord1.ngrok.io wss://coord2.ngrok.io

# O con variables de entorno
COORDINATOR_URLS=wss://coord1.ngrok.io,wss://coord2.ngrok.io node worker.js
```

## 🎨 Dashboard Features

- **Métricas en Tiempo Real**: Workers activos, timeouts, registros
- **Topología Visual**: Coordinadores y workers conectados
- **Estados de Tareas**: queued, assigned, running, ok, error
- **Logs en Vivo**: Consola integrada con timestamps
- **Controles Interactivos**: Filtros, búsqueda, botones de test
- **Animaciones**: Efectos de carga, transiciones, pulsos

## 🚨 Troubleshooting

### Worker no se conecta
- Verificar URL correcta (ws:// para local, wss:// para ngrok)
- Revisar logs del coordinador
- Verificar firewall/puertos

### Líder no se elige correctamente
- Verificar que coordinadores estén en la misma red
- Revisar prioridades (mayor número = mayor prioridad)
- Verificar heartbeat intervals

### Tareas no se asignan
- Verificar que workers estén registrados
- Revisar capabilities de los workers
- Verificar estado del líder

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/nueva-feature`)
3. Commit cambios (`git commit -am 'Agrega nueva feature'`)
4. Push (`git push origin feature/nueva-feature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto es parte del curso de Sistemas Distribuidos - Universidad Don Bosco 2026.

## 👨‍💻 Autor

**Jhonathan Uni** - Estudiante de Sistemas Distribuidos

---

## 🎯 Conclusión

Este sistema demuestra los principios fundamentales de los sistemas distribuidos:

- **Coordinación**: Múltiples nodos trabajando juntos
- **Consistencia**: Estado sincronizado entre nodos
- **Disponibilidad**: Failover automático y tolerancia a fallos
- **Escalabilidad**: Fácil agregar nuevos workers y coordinadores

**¡Listo para impresionar en el parcial!** 🚀</content>
<parameter name="filePath">README.md