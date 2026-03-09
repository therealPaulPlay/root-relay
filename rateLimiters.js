import rateLimit from "express-rate-limit";

// Standard: 10 requests per second per IP
export const standardLimiter = rateLimit({
    windowMs: 1000,
    keyGenerator: (req) => req.clientIp,
    max: 10,
    message: { error: "Too many requests." },
});

// WebSocket upgrades: 5 per second per IP
export const upgradeLimiter = rateLimit({
    windowMs: 1000,
    keyGenerator: (req) => req.clientIp,
    max: 5,
    message: { error: "Too many WebSocket upgrade requests." },
});

// Notification image uploads: 5 per 10 seconds per IP
export const imageUploadLimiter = rateLimit({
    windowMs: 10_000,
    keyGenerator: (req) => req.clientIp,
    max: 5,
    message: { error: "Too many image uploads." },
});
