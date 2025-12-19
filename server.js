import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import requestIp from "request-ip";
import cors from "cors";
import { WebSocketServer } from "ws";
import http from 'node:http';
import { config } from "./config.js";
import { randomUUID } from "node:crypto";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3Client, getPublicObjectURL } from "./s3Client.js";

const app = express();
const server = http.createServer(app);

const standardLimiter = rateLimit({
    windowMs: 1000, // 1 second
    keyGenerator: (req) => req.clientIp, // correct IP
    max: 5, // limit each IP to 5 requests per windowMs
    message: { error: 'Too many standard requests.' }
});

app.use(cors(config.corsOptions));
app.use(express.json());
app.use(requestIp.mw());
app.use(standardLimiter); // Global rate limiting, also apply to ugprade requests

const clients = {}; // WS clients
const deviceIdClients = new Map(); // device ID -> [clientIdArray] (for connected devices like phones and laptops)
const productIdClients = new Map(); // product ID -> [clientIdArray] (for connected root products like the Observer)

async function initWebSocketServer(server) {
    try {
        const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 }); // 16 MB

        // Start heartbeat
        const heartbeatInterval = setInterval(() => {
            wss.clients.forEach(ws => {
                if (!ws.isAlive) return ws.terminate();
                ws.isAlive = false;
                ws.ping();
            });
        }, 15000);

        wss.on("connection", (ws, req) => {
            ws.clientId = randomUUID();
            ws.isAlive = true;

            const url = new URL(req.url, `http://${req.headers.host}`);
            const deviceId = url.searchParams.get("device-id");
            const productId = url.searchParams.get("product-id");

            // Verify query params
            if (!deviceId && !productId) return ws.close(1008, "Missing device-id or product-id");
            if (deviceId && productId) return ws.close(1008, "Can't provide both device-id and product-id");

            // Store device or product ID
            if (deviceId) deviceIdClients.set(deviceId, [...deviceIdClients.get(deviceId) || [], ws.clientId]);
            if (deviceId) ws.deviceId = deviceId;
            if (productId) productIdClients.set(productId, [...productIdClients.get(productId) || [], ws.clientId]);
            if (productId) ws.productId = productId;

            ws.on('pong', () => { ws.isAlive = true; });

            ws.on("message", (msg) => {
                try {
                    const message = JSON.parse(msg);
                    if (!["device", "product"].includes(message.target)) throw new Error("Message target is invalid!");

                    if (message.target == "device") {
                        if (!message.deviceId) throw new Error("Message lacks device ID!");
                        const targets = deviceIdClients.get(message.deviceId) || [];
                        targets.forEach((targetClientId) => {
                            const targetWs = clients[targetClientId];
                            targetWs.send(JSON.stringify(message));
                        });

                    } else if (message.target == "product") {
                        if (!message.productId) throw new Error("Message lacks product ID!");
                        const targets = productIdClients.get(message.productId) || [];
                        targets.forEach((targetClientId) => {
                            const targetWs = clients[targetClientId];
                            targetWs.send(JSON.stringify(message));
                        });
                    }

                } catch (error) {
                    console.error("Error occured in WebSocket message callback:", error);
                }
            });

            ws.on("close", () => {
                // Remove client ID & remove from maps
                delete clients[ws.clientId];

                if (ws.productId) {
                    const products = productIdClients.get(ws.productId) || [];
                    products.filter((e) => e != ws.clientId);
                    if (!products.length) productIdClients.delete(ws.productId);
                }
                if (ws.deviceId) {
                    const devices = deviceIdClients.get(ws.deviceId) || [];
                    devices.filter((e) => e != ws.deviceId);
                    if (!devices.length) deviceIdClients.delete(ws.deviceId);
                }
            });

            ws.on("error", (error) => {
                console.error(`Error in WebSocket client ${ws.clientId}:`, error);
            });
        });

        console.log("WebSocket server initialized.");
    } catch (error) {
        console.error("Failed to initialize WebSocket server:", error);
    }
}

initWebSocketServer(server);

// TODO: rate limit WS messages to 100 msgs / sec
// TODO: rate limit upgrade endpoint to 5 / sec

app.get("/firmware/observer", standardLimiter, async (req, res) => {
    try {
        const command = new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET_NAME,
            Prefix: "rootprivacy/firmware/observer/",
        });

        const response = await s3Client.send(command);

        // Filter out folders (keys ending with '/'), only get actual files
        const files = (response.Contents || []).filter(item => !item.Key.endsWith('/'));

        if (files.length === 0) {
            return res.status(404).json({ error: "No firmware found!" });
        }

        // Get the first file and extract version from filename
        const file = files[0];
        const versionMatch = file.Key.match(/(\d+\.\d+\.\d+)/);

        if (!versionMatch) {
            return res.status(404).json({ error: "No version found in filename!" });
        }

        const url = await getPublicObjectURL(file.Key);
        return res.status(200).json({ version: versionMatch[1], url });

    } catch (error) {
        console.error("Error fetching firmware:", error);
        return res.status(500).json({ error: "Failed to fetch firmware" });
    }
});

// Health check
app.get("/health", (req, res) => {
    return res.status(200).json({ message: "Server is operational." });
});

server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
});
