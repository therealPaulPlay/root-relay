# ROOT (Relay)
Relay server for ROOT. Used for relaying end-2-end encrypted data between connected devices and ROOT products, and enables OTA updates.

## How to self-host
1. Configure a `.env` file as according to the `.env.example`. If you don't want to host your own updates, leave `REDIRECT_UPDATES` as `"true"`.
2. Host the application using `Docker`. A `Dockerfile` is provided. 
3. Use a webserver such as `nginx` to route your chosen relay domain (e.g. relay.your-domain.com) to the relay server's port. By default, that port is `3013`.
4. Check if the server is running by making a `GET` request to `relay.your-domain.com/health`.
5. In the settings of ROOT Connect, input your relay server URL.
6. Set up your ROOT products using your own relay domain. If they are already paired, re-peat the pairing flow (you'll be prompted to skip to the relay configuration).