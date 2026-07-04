export const OFFICIAL_RELAY_DOMAIN = "relay.rootprivacy.com";
export const TRUSTED_PROXIES_COUNT = 1; // Proxy count for extracting IP from X-Forwarded-For header
export const CLIENT_IP_HEADER = process.env.CLIENT_IP_HEADER; // Optional header to read the client IP from instead (e.g. do-connecting-ip on DigitalOcean)
