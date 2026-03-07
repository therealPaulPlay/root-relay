import express from "express";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3Client, getPublicObjectURL } from "./s3Client.js";
import { OFFICIAL_RELAY_DOMAIN } from "./config.js";

// Cache for firmware metadata (read from S3 latest.json)
let firmwareMetadataCache = null;
let firmwareCacheTime = 0;
const FIRMWARE_CACHE_TTL = 60 * 1000; // 1 minute cache

const firmwareRouter = express.Router();

firmwareRouter.get("/observer/update", async (req, res) => {
    try {
        // If no env variable is provided, the value will not be "false" -> defaults to redirect
        if (process.env.REDIRECT_UPDATES === "false") {

            // Check cache
            const now = Date.now();
            if (firmwareMetadataCache && (now - firmwareCacheTime) < FIRMWARE_CACHE_TTL) return res.status(200).json(firmwareMetadataCache);

            // Fetch latest.json metadata from S3
            let response;
            try {
                response = await s3Client.send(new GetObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: "rootprivacy/updates/release/latest.json"
                }));
            } catch (err) {
                if (err.name === "NoSuchKey") return res.status(404).json({ error: "No update file, latest.json is missing!" });
                throw err;
            }

            const bodyString = await response.Body.transformToString();
            const metadata = JSON.parse(bodyString);

            // Build the public URL for the RAUC bundle
            const bundleUrl = await getPublicObjectURL(`rootprivacy/updates/release/${metadata.filename}`);

            // Build response with RAUC-compatible format
            const firmwareInfo = {
                version: metadata.version,
                url: bundleUrl,
                sha256: metadata.sha256,
                size: metadata.size || 0,
                compatible: metadata.compatible
            };

            // Update cache
            firmwareMetadataCache = firmwareInfo;
            firmwareCacheTime = now;

            return res.status(200).json(firmwareInfo);
        } else {
            // Redirect to official relay server
            const response = await fetch(`https://${OFFICIAL_RELAY_DOMAIN}/firmware/observer/update`);
            const data = await response.json().catch(() => ({ error: "Official relay returned invalid JSON!" }));
            return res.status(response.status).json(data);
        }

    } catch (error) {
        console.error("Error fetching firmware:", error);
        return res.status(500).json({ error: "Failed to fetch firmware" });
    }
});

firmwareRouter.get("/observer/image", async (req, res) => {
    try {
        const response = await s3Client.send(new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET_NAME,
            Prefix: "rootprivacy/images/release/"
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