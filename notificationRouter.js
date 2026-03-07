import express from "express";
import { createSign } from "node:crypto";
import { OFFICIAL_RELAY_DOMAIN } from "./config.js";

const notificationRouter = express.Router();

// Takes a message and fcmToken, and utilizes the Firebase FCM API to 
// send the notification to the desired device
notificationRouter.post("/send", async (req, res) => {
    try {
        const { fcmToken, message } = req.body;
        if (!fcmToken || !message) return res.status(400).json({ error: "Missing required fields: fcmToken, message" });

        // Forward to the official server
        if (process.env.REDIRECT_NOTIFICATIONS !== "false") {
            const response = await fetch(`https://${OFFICIAL_RELAY_DOMAIN}/notifications/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req.body),
            });
            const data = await response.json().catch(() => ({ error: "Official relay returned invalid JSON!" }));
            return res.status(response.status).json(data);

        } else {
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

export default notificationRouter;
