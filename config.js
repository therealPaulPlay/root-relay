export const config = {
    corsOptions: {
        origin: [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://rootprivacy.com",
            "http://relay.rootprivacy.com"
        ]
    },
    port: 3013,
    s3Domain: "digitaloceanspaces.com",
    s3Region: "fra1"
}