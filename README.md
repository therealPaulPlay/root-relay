# ROOT (Relay)
Relay server for ROOT. Used for relaying end-2-end encrypted data between connected devices and ROOT products, and enables OTA updates.

## One-click deploy

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/therealPaulPlay/root-relay/tree/main&refcode=65ee4841aa2f)

Once deployed, click "Live App" and you should get redirected to a URL like `https://root-relay-abcd.ondigitalocean.app/`. To verify it's working, test the `/health` route 
direclty in the browser (simply append it to the URL). You should get a positive response.

## How to self-host

The easiest way to self-host the relay server is to utilize DigitalOcean's one-click deploy feature.
However, if you prefer to host it your own way, here are the steps:

1. Configure a `.env` file as according to the `.env.example`. If you don't want to host your own updates, leave `REDIRECT_UPDATES` as `"true"`.
2. Host the application using `Docker`. A `Dockerfile` is provided. 
3. Use a webserver such as `nginx` to route your chosen relay domain (e.g. relay.your-domain.com) to the relay server's port. By default, that port is `3013`.
4. Set up SSL and ensure your domain's DNS points to your server.
5. Check if the server is running by making a `GET` request to `relay.your-domain.com/health`.
6. In the settings of ROOT Connect, input your relay server URL.
7. Set up your ROOT products using your own relay domain. If they are already paired, re-peat the pairing flow (you'll be prompted to skip to the relay configuration).