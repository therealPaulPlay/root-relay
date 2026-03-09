import express from "express";
import { randomUUID, createSign } from "node:crypto";
import { PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { s3Client, getPublicObjectURL } from "./s3Client.js";
import { imageUploadLimiter, standardLimiter } from "./rateLimiters.js";
import { OFFICIAL_RELAY_DOMAIN } from "./config.js";

const notificationRouter = express.Router();

const PREVIEW_MAX_BYTES = 100 * 1024; // 100 KB
const PREVIEW_PREFIX = "rootprivacy/notification-previews/";

// Takes an FCM message payload and sends it via the Firebase FCM API
notificationRouter.post("/send", standardLimiter, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: "Missing required field: message" });

        if (process.env.REDIRECT_NOTIFICATIONS === "false") {
            // Send via FCM HTTP v1 API
            const accessToken = await getAccessToken();
            if (!accessToken) return res.status(500).json({ error: "Failed to obtain FCM access token!" });

            const fcmResponse = await fetch(
                `https://fcm.googleapis.com/v1/projects/${process.env.FCM_PROJECT_ID}/messages:send`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({ message }),
                }
            );

            if (!fcmResponse.ok) {
                const errorData = await fcmResponse.json().catch(() => ({}));
                console.error("FCM send failed:", fcmResponse.status, errorData);
                return res.status(fcmResponse.status).json({ error: "FCM send failed!", details: errorData });
            }

            return res.status(200).json({ success: true });
        } else {
            // Forward to the official server
            const response = await fetch(`https://${OFFICIAL_RELAY_DOMAIN}/notifications/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req.body),
            });
            const data = await response.json().catch(() => ({ error: "Official relay returned invalid JSON!" }));
            return res.status(response.status).json(data);
        }
    } catch (error) {
        console.error("Error sending notification:", error);
        return res.status(500).json({ error: "Failed to send notification!" });
    }
});

// FCM HTTP v1 API requires OAuth2 access tokens from a service account
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    try {
        const credentials = JSON.parse(Buffer.from(process.env.FCM_SERVICE_ACCOUNT_JSON_AS_BASE64 || "", "base64").toString());
        if (!credentials.client_email || !credentials.private_key) {
            console.error("FCM service account credentials missing or invalid.");
            return null;
        }

        // Build JWT for Google OAuth2
        const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
        const now = Math.floor(Date.now() / 1000);
        const claimSet = Buffer.from(JSON.stringify({
            iss: credentials.client_email,
            scope: "https://www.googleapis.com/auth/firebase.messaging",
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
        })).toString("base64url");

        const sign = createSign("RSA-SHA256");
        sign.update(`${header}.${claimSet}`);
        const signature = sign.sign(credentials.private_key, "base64url");

        const jwt = `${header}.${claimSet}.${signature}`;

        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
        });

        if (!tokenResponse.ok) {
            console.error("Failed to obtain access token:", tokenResponse.status);
            return null;
        }

        const tokenData = await tokenResponse.json();
        cachedToken = tokenData.access_token;
        tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000; // Refresh 1 minute early
        return cachedToken;
    } catch (error) {
        console.error("Error obtaining FCM access token:", error);
        return null;
    }
}

// Upload an encrypted notification preview image to S3
// Returns a URL that can be included in the notification payload
notificationRouter.post("/upload-preview", imageUploadLimiter, express.raw({ type: "application/octet-stream", limit: PREVIEW_MAX_BYTES }), async (req, res) => {
    try {
        // Encrypted data must be at least nonce (12) + tag (16) + 1 byte
        if (!req.body?.length || req.body.length < 29) return res.status(400).json({ error: "Payload too small to be valid encrypted data!" });

        if (process.env.REDIRECT_NOTIFICATIONS === "false") {
            const id = randomUUID();
            const key = `${PREVIEW_PREFIX}${id}`;

            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: key,
                Body: req.body,
                ContentLength: req.body.length,
                ContentType: "application/octet-stream",
                CacheControl: "no-store",
                ACL: "public-read",
            }));

            const url = await getPublicObjectURL(key);
            return res.status(200).json({ url });
        } else {
            // Forward to the official server
            const response = await fetch(`https://${OFFICIAL_RELAY_DOMAIN}/notifications/upload-preview`, {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: req.body,
            });
            const data = await response.json().catch(() => ({ error: "Official relay returned invalid JSON!" }));
            return res.status(response.status).json(data);
        }
    } catch (error) {
        console.error("Error uploading notification image:", error);
        return res.status(500).json({ error: "Failed to upload preview image!" });
    }
});

// Clean up expired notification preview images every hour
const IMAGE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

async function cleanupExpiredPreviews() {
    try {
        const cutoff = new Date(Date.now() - IMAGE_MAX_AGE_MS);
        let continuationToken;
        let totalDeleted = 0;

        do {
            const response = await s3Client.send(new ListObjectsV2Command({
                Bucket: process.env.S3_BUCKET_NAME,
                Prefix: PREVIEW_PREFIX,
                ContinuationToken: continuationToken,
            }));

            const expired = (response.Contents || []).filter((obj) => obj.LastModified < cutoff);
            if (expired.length > 0) {
                await s3Client.send(new DeleteObjectsCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Delete: { Objects: expired.map((obj) => ({ Key: obj.Key })) },
                }));
                totalDeleted += expired.length;
            }

            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (continuationToken);

        if (totalDeleted > 0) console.log(`Cleaned up ${totalDeleted} expired notification preview(s).`);
    } catch (error) {
        console.error("Error cleaning up notification previews:", error);
    }
}

// Only run cleanup when this server owns the S3 storage
if (process.env.REDIRECT_NOTIFICATIONS === "false") setInterval(cleanupExpiredPreviews, 60 * 60 * 1000);

export default notificationRouter;
