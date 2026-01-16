import "dotenv/config";
import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
    region: process.env.S3_REGION,
    endpoint: "https://" + process.env.S3_REGION + "." + process.env.S3_DOMAIN,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    }
});

// Get file URL – direct URL for publicly readable objects
export async function getPublicObjectURL(key) {
    return `https://${process.env.S3_BUCKET_NAME}.${process.env.S3_REGION}.${process.env.S3_DOMAIN}/${key}`;
}