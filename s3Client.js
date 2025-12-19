import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";

export const s3Client = new S3Client({
    region: config.s3Region,
    endpoint: "https://" + config.s3Region + "." + config.s3Domain,
    credentials: {
        accessKeyId: process.env.s3AccessKeyId,
        secretAccessKey: process.env.s3AccessKey,
    }
});

// Get file URL – direct URL for publicly readable objects
export async function getPublicObjectURL(key) {
    return `https://${process.env.s3BucketName}.${config.s3Region}.${config.s3Domain}/${key}`;
}