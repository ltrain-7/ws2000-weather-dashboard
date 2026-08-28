# HTTPS and TLS setup

The dashboard supports two TLS patterns:

- **Synology DSM (recommended):** DSM terminates HTTPS and proxies to the container over local HTTP.
- **Raspberry Pi/Linux:** use Caddy as a TLS reverse proxy, or enable the app's native Node HTTPS support.

HTTPS encrypts traffic but does not itself add authentication. The app supports an optional built-in administrator login; see [Administrator authentication](AUTHENTICATION.md). Keep the public dashboard LAN-only or use a VPN unless you deliberately protect the entire site. Never forward host port `3000` from the router.

## Synology DSM 7.2–7.4

Leave `TLS_ENABLED=false` in `.env`. DSM should own the certificate so it can renew it without copying private keys into the container.

### 1. Choose a hostname and certificate

A publicly trusted certificate needs a hostname such as `weather.example.com`; certificate authorities do not normally issue certificates for private IP addresses such as `172.31.1.134`.

In **Control Panel → Security → Certificate**, add a certificate for the hostname. Choose **Get a certificate from Let's Encrypt** when the hostname resolves correctly and the validation requirements can reach the NAS. Synology DDNS or a domain you control can supply the hostname. For LAN-only use, you may instead import a certificate from your own trusted local certificate authority.

### 2. Create the reverse proxy

In **Control Panel → Login Portal → Advanced → Reverse Proxy**, create this rule:

| Setting | Value |
| --- | --- |
| Description | `WS2000 dashboard` |
| Source protocol | `HTTPS` |
| Source hostname | Your certificate hostname, for example `weather.example.com` |
| Source port | `443` |
| Destination protocol | `HTTP` |
| Destination hostname | `127.0.0.1` |
| Destination port | `3000` |

Under **Custom Header**, choose **Create → WebSocket**. The dashboard currently uses server-sent events rather than WebSockets, but retaining standard proxy upgrade headers is safe and avoids future compatibility trouble. In **Advanced Settings**, use HTTP/1.1 and raise the proxy read timeout if live updates disconnect regularly.

Assign the new certificate to the reverse-proxy hostname using **Control Panel → Security → Certificate → Settings** (the button may be named **Configure** on some DSM releases). Then open `https://weather.example.com` and verify that the browser shows the expected certificate.

Keep port `3000` restricted to the LAN in the DSM firewall. If remote access is required, prefer a VPN. If using direct internet access, forward only TCP 443 to the NAS, protect the dashboard with authentication, and understand the certificate provider's renewal requirements before restricting port 80.

For built-in administrator authentication, use the loopback binding shown below and set `ADMIN_TRUST_PROXY=true`. This allows secure session cookies only through the DSM HTTPS hostname and prevents clients from bypassing DSM through port 3000.

DSM 8 has not yet been validated for this project. If its labels change, use the equivalent **reverse proxy** and **certificate assignment** screens; the source remains HTTPS on 443 and the destination remains HTTP on `127.0.0.1:3000`.

Synology reference: [configure DSM reverse proxy and access control](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_login_portal_advanced?version=7).

## Raspberry Pi/Linux: Caddy (recommended)

Caddy automatically obtains and renews certificates. Keep the dashboard on HTTP and bind it to loopback so only Caddy can reach it.

1. Set these values in `.env`:

   ```text
   DASHBOARD_PORT=127.0.0.1:3000
   TLS_ENABLED=false
   ```

2. Install Caddy using its official instructions, then add this to `/etc/caddy/Caddyfile`:

   ```caddyfile
   weather.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

3. Validate and reload Caddy:

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

4. Open `https://weather.example.com` and verify the certificate. Public certificates require working DNS and certificate-authority validation. For LAN-only names, use Caddy's local CA and install its root certificate on each client, or use a VPN that provides HTTPS.

The Compose port syntax accepts the loopback binding above because `docker-compose.yml` expands it as `127.0.0.1:3000:3000`.

## Raspberry Pi/Linux: native Node TLS

Native TLS is useful when another proxy is undesirable and certificate renewal is managed separately.

1. Create the certificate directory and copy PEM files into it:

   ```sh
   mkdir -p certs
   cp /path/to/fullchain.pem certs/fullchain.pem
   cp /path/to/privkey.pem certs/privkey.pem
   chmod 600 certs/privkey.pem
   ```

   The `certs` directory is excluded from Git. Never commit or share the private key. The container runs as UID 1000, so ensure that UID can read both files; `chmod 640` with an appropriate group is also suitable.

2. Set these values in `.env`:

   ```text
   TLS_ENABLED=true
   TLS_CERT_PATH=/app/certs/fullchain.pem
   TLS_KEY_PATH=/app/certs/privkey.pem
   ```

3. Recreate and test the container:

   ```sh
   docker compose up -d --force-recreate
   curl --fail https://localhost:3000/api/health
   ```

   For a private or self-signed test certificate only, use `curl --insecure`; do not treat that as certificate validation.

The server requires TLS 1.2 or newer and exits at startup if TLS is enabled but either PEM file cannot be read. After a certificate renewal, copy or replace the mounted PEM files and run `docker compose restart` so Node loads the new certificate. An automated renewal hook should perform that restart.

To return to HTTP, set `TLS_ENABLED=false` and recreate the container. Do not enable native TLS behind DSM's HTTP destination rule; either leave Node on HTTP or change the proxy destination to HTTPS and configure certificate verification deliberately.
