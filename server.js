import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import requestIp from "request-ip";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from 'node:http';
import { decode, encode } from "cbor-x";
import firmwareRouter from "./firmwareRouter.js";

const PORT = Number(process.env.PORT) || 3013;

const app = express();
const server = http.createServer(app);

// 5 requests per second
const standardLimiter = rateLimit({
    windowMs: 1000,
    keyGenerator: (req) => req.clientIp,
    max: 5,
    message: { error: 'Too many standard requests.' }
});

const upgradeLimiter = rateLimit({
    windowMs: 1000,
    keyGenerator: (req) => req.clientIp,
    max: 5,
    message: { error: 'Too many WebSocket upgrade requests.' }
});

// Allow requests from the ROOT website
app.use(cors({
    origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://rootprivacy.com",
    ]
}));
app.use(express.json());
app.use(requestIp.mw());
app.use((req, res, next) => {
    if (req.headers.upgrade === 'websocket') return upgradeLimiter(req, res, next);
    return standardLimiter(req, res, next);
});

// Routers
app.use("/firmware", firmwareRouter);

const clients = new Map(); // clientId -> Set<WebSocket>

async function initWebSocketServer(server) {
    try {
        const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 3 * 1024 * 1024 }); // 3 MB message size limit

        // Start heartbeat
        setInterval(() => {
            wss.clients.forEach(ws => {
                if (!ws.isAlive) return ws.terminate();
                ws.isAlive = false;
                ws.ping();
            });
        }, 15000);

        wss.on("connection", (ws, req) => {
            ws.isAlive = true;
            ws.isTerminating = false;
            ws.messageCount = 0;
            ws.messageWindow = Date.now();

            const url = new URL(req.url, `http://${req.headers.host}`);
            const clientId = url.searchParams.get("client-id");
            if (!clientId) return ws.close(1008, "Missing client-id!");

            ws.clientId = clientId;
            if (!clients.has(clientId)) clients.set(clientId, new Set());
            clients.get(clientId).add(ws);

            ws.on('pong', () => { ws.isAlive = true; });

            ws.on("message", (msg) => {
                // Rate limiting: 25 messages per second
                const now = Date.now();
                if (now - ws.messageWindow > 1000) {
                    ws.messageWindow = now;
                    ws.messageCount = 0;
                }
                ws.messageCount++;
                if (ws.messageCount > 25) {
                    if (!ws.isTerminating) {
                        ws.isTerminating = true;
                        ws.close(1008, "Rate limit exceeded!");
                        console.error(`WebSocket connection closed due to rate limit exceeded.`);
                    }
                    return;
                }

                try {
                    const message = decode(msg);
                    if (!message.targetId) throw new Error("Message lacks targetId!");

                    // Route to all clients with matching clientId
                    const targets = clients.get(message.targetId);
                    if (targets) {
                        const encoded = encode(message);
                        targets.forEach((targetWs) => {
                            if (targetWs.readyState === WebSocket.OPEN) targetWs.send(encoded);
                        });
                    }

                } catch (error) {
                    console.error("Error in WebSocket message callback:", error);
                }
            });

            ws.on("close", () => {
                const set = clients.get(ws.clientId);
                if (set) {
                    set.delete(ws);
                    if (set.size === 0) clients.delete(ws.clientId);
                }
            });

            ws.on("error", (error) => {
                console.error(`WebSocket client error:`, error);
            });
        });

        console.log("WebSocket server initialized.");
    } catch (error) {
        console.error("Failed to initialize WebSocket server:", error);
    }
}

initWebSocketServer(server);

// Health check
app.get("/health", (req, res) => {
    return res.status(200).json({ message: "Server is operational." });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    clients.forEach((sockets) => sockets.forEach((ws) => ws.close()));
    server.close();
    process.exit(0);
});
