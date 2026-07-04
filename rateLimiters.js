import rateLimit from "express-rate-limit";
import proxyaddr from "proxy-addr";
import { TRUSTED_PROXIES_COUNT, CLIENT_IP_HEADER } from "./config.js";

const MAX_CONNECTIONS_PER_IP = 100;
const CONNECTIONS_PER_IP_WARN_THRESHOLD = 10;

export const getIp = (req) => (CLIENT_IP_HEADER && req.headers[CLIENT_IP_HEADER]) || proxyaddr(req, (addr, hop) => hop < TRUSTED_PROXIES_COUNT);

// Standard: 10 requests per second per IP
export const standardLimiter = rateLimit({
    windowMs: 1000,
    keyGenerator: getIp,
    max: 10,
    message: { error: "Too many requests." },
});

// Limit open WebSocket connections per IP (upgrades bypass Express, hence the connection handler calls this directly)
const wsConnections = new Map(); // IP -> open connection count

export const wsConnectionLimiter = {
    isFull(req) {
        return (wsConnections.get(getIp(req)) || 0) >= MAX_CONNECTIONS_PER_IP;
    },
    register(req) {
        const ip = getIp(req);
        const count = (wsConnections.get(ip) || 0) + 1;
        if (count === CONNECTIONS_PER_IP_WARN_THRESHOLD) console.warn(`IP ${ip} now holds ${count} open WebSocket connections.`);
        wsConnections.set(ip, count);
        return ip; // Returns IP the connection was registered under
    },
    release(ip) {
        const count = (wsConnections.get(ip) || 0) - 1;
        if (count > 0) wsConnections.set(ip, count);
        else wsConnections.delete(ip);
    },
};

// Notification image uploads: 5 per 10 seconds per IP
export const imageUploadLimiter = rateLimit({
    windowMs: 10_000,
    keyGenerator: getIp,
    max: 5,
    message: { error: "Too many image uploads." },
});
