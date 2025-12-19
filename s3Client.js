import "dotenv/config";
import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";

export const s3Client = new S3Client({
    region: config.s3Region,
    endpoint: "https://" + config.s3Region + "." + config.s3Domain,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_ACCESS_KEY,
    }
});

// Get file URL – direct URL for publicly readable objects
export async function getPublicObjectURL(key) {
    return `https://${process.env.S3_BUCKET_NAME}.${config.s3Region}.${config.s3Domain}/${key}`;
}