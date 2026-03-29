import express from "express";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3Client, getPublicObjectURL } from "./s3Client.js";
import { OFFICIAL_RELAY_DOMAIN } from "./config.js";
import { standardLimiter } from "./rateLimiters.js";

const firmwareRouter = express.Router();

const UPDATES_PREFIX = "rootprivacy/updates/";
const IMAGES_PREFIX = "rootprivacy/images/release/";

// Per-channel cache for firmware update metadata (read from S3 latest.json)
const firmwareUpdateCache = {};
const FIRMWARE_CACHE_TTL = 60 * 1000; // 1 minute cache

async function handleFirmwareUpdate(channel, req, res) {
    try {
        const channelPrefix = `${UPDATES_PREFIX}${channel}/`;

        // If no env variable is provided, the value will not be "false" -> defaults to redirect
        if (process.env.REDIRECT_UPDATES === "false") {

            // Check cache
            const now = Date.now();
            const cached = firmwareUpdateCache[channel];
            if (cached && (now - cached.time) < FIRMWARE_CACHE_TTL) return res.status(200).json(cached.data);

            // Fetch latest.json metadata from S3
            let response;
            try {
                response = await s3Client.send(new GetObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: `${channelPrefix}latest.json`
                }));
            } catch (err) {
                if (err.name === "NoSuchKey") return res.status(404).json({ error: "No update file, latest.json is missing!" });
                throw err;
            }

            const bodyString = await response.Body.transformToString();
            const metadata = JSON.parse(bodyString);

            // Build the public URL for the RAUC bundle
            const bundleUrl = await getPublicObjectURL(`${channelPrefix}${metadata.filename}`);

            // Build response with RAUC-compatible format
            const firmwareInfo = {
                version: metadata.version,
                url: bundleUrl,
                sha256: metadata.sha256,
                size: metadata.size || 0,
                compatible: metadata.compatible
            };

            // Update cache
            firmwareUpdateCache[channel] = { data: firmwareInfo, time: now };

            return res.status(200).json(firmwareInfo);
        } else {
            // Redirect to official relay server
            const response = await fetch(`https://${OFFICIAL_RELAY_DOMAIN}/firmware/observer/update${channel !== "release" ? `/${channel}` : ""}`);
            const data = await response.json().catch(() => ({ error: "Official relay returned invalid JSON!" }));
            return res.status(response.status).json(data);
        }

    } catch (error) {
        console.error(`Error fetching ${channel} firmware:`, error);
        return res.status(500).json({ error: "Failed to fetch firmware" });
    }
}

// Observer firmware updates (release channel)
firmwareRouter.get("/observer/update", standardLimiter, (req, res) => handleFirmwareUpdate("release", req, res));

// Observer firmware updates (dev channel)
firmwareRouter.get("/observer/update/dev", standardLimiter, (req, res) => handleFirmwareUpdate("dev", req, res));

// Used for downloading the current Observer firmware image from the ROOT website
firmwareRouter.get("/observer/image", standardLimiter, async (req, res) => {
    try {
        const response = await s3Client.send(new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET_NAME,
            Prefix: IMAGES_PREFIX
        }));

        const files = (response.Contents || [])
            .filter(obj => obj.Key.endsWith(".img.gz"))
            .sort((a, b) => b.LastModified - a.LastModified);

        if (files.length === 0) return res.status(404).json({ error: "No firmware image available!" });

        const images = await Promise.all(files.map(async (file) => {
            const filename = file.Key.split("/").pop();
            const url = await getPublicObjectURL(file.Key);
            return { url, filename };
        }));

        return res.status(200).json({ images });

    } catch (error) {
        console.error("Error fetching firmware image URL:", error);
        return res.status(500).json({ error: "Failed to fetch firmware image!" });
    }
});

export default firmwareRouter;
