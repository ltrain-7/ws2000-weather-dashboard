# HTTPS and TLS setup

The dashboard supports two TLS patterns:

- **Synology DSM (recommended):** DSM terminates HTTPS and proxies to the container over local HTTP.
- **Raspberry Pi/Linux:** use Caddy as a TLS reverse proxy, or enable the app's native Node HTTPS support.

HTTPS encrypts traffic but does not itself add authentication. The app supports an optional built-in administrator login; see [Administrator authentication](AUTHENTICATION.md). Keep the public dashboard LAN-only or use a VPN unless you deliberately protect the entire site. Never forward host port `3000` from the router.

## Synology DSM 7.2–7.4

Leave `TLS_ENABLED=false` in `.env`. DSM should own the certificate so it can renew it without copying private keys into the container.

### 1. Choose a hostname and certificate

A publicly trusted certificate needs a hostname such as `weather.example.com`; certificate authorities do not normally issue certificates for private IP addresses such as `192.168.1.10`.

In **Control Panel → Security → Certificate**, add a certificate for the hostname. Choose **Get a certificate from Let's Encrypt** when the hostname resolves correctly and the validation requirements can reach the NAS. Synology DDNS or a domain you control can supply the hostname. For LAN-only use, you may instead import a certificate from your own trusted local certificate authority.

### Private DSM HTTPS with DNS-01

DNS-01 allows Let's Encrypt to issue a publicly trusted certificate without connecting to the NAS. This is the preferred pattern when the dashboard must remain LAN-only.

Use example names consistently throughout the setup:

- `nas.example.com` for DSM;
- `weather.example.com` for the dashboard; and
- `192.168.1.10` for the private NAS address.

Replace them with names in a domain you control and the actual private address. Do not request a certificate for an IP address or a made-up local suffix.

#### DNS and privacy requirements

1. Configure LAN or split-horizon DNS so both hostnames resolve to the private NAS address. A private `weather` CNAME pointing to `nas.example.com` is also acceptable.
2. Do not publish public A or AAAA records for either hostname and do not forward ports 80, 443, 5001, or 3000 from the router.
3. Keep the domain's authoritative public DNS available. DNS-01 temporarily publishes TXT records under `_acme-challenge.nas.example.com` and `_acme-challenge.weather.example.com` to prove ownership.
4. Remember that publicly trusted certificates are recorded in Certificate Transparency logs. The hostnames become public information even though the services remain unreachable from the internet.

The NAS needs only outbound HTTPS access to the certificate authority and DNS provider APIs.

#### GoDaddy Personal Access Token

Create a production GoDaddy Personal Access Token with only these scopes:

- `domains.domain:read`
- `domains.dns:update`

Choose an expiration long enough for unattended renewal and arrange a reminder before the token expires. Store the token in the ACME client's root-owned configuration directory with mode `600`; never put it in `.env`, a Compose file, a command line, GitHub, screenshots, or logs.

GoDaddy supports Bearer tokens for DNS management. At the time this procedure was tested, `acme.sh` 3.1.4's built-in `dns_gd` hook still expected the older `sso-key KEY:SECRET` format. A GoDaddy PAT therefore requires a Bearer-token-compatible GoDaddy hook. Do not split a PAT into fake key and secret values. An ACME client receiving HTTP `401` has an invalid, expired, revoked, or incorrectly formatted credential; HTTP `403` normally means the token lacks a required scope.

This repository does not bundle a DNS-provider hook. Review and pin any hook before installing it because it receives a credential that can modify public DNS. Prefer a narrowly scoped PAT, root-only permissions, and a persistent ACME folder that is excluded from Git and ordinary backups shared with other people.

#### Issue one SAN certificate

Run the ACME client as root from a persistent folder outside the container. The issuance must use the GoDaddy PAT-compatible DNS hook and include both names. For an `acme.sh`-compatible hook named `dns_gd_pat`, the request has this form:

```sh
/volume1/docker/ws2000-dashboard/acme-client/acme.sh \
  --issue \
  --server letsencrypt \
  --dns dns_gd_pat \
  --keylength 2048 \
  -d nas.example.com \
  -d weather.example.com \
  --home /volume1/docker/ws2000-dashboard/acme-client \
  --config-home /volume1/docker/ws2000-dashboard/acme-data \
  --cert-home /volume1/docker/ws2000-dashboard/acme-certs
```

Enter the PAT through an interactive hidden prompt or root-only secrets file. Do not place it directly after `export` in a recorded terminal session. The issued certificate should have `nas.example.com` as its common name and both hostnames as SANs.

#### Import and renew through DSM

The `acme.sh` Synology deployment hook can import the certificate without permanently storing a DSM administrator password. Run it natively on the NAS as root so it can create and remove its temporary local administrator:

```sh
SYNO_USE_TEMP_ADMIN=1 \
SYNO_LOCAL_HOSTNAME=1 \
SYNO_CREATE=1 \
SYNO_CERTIFICATE='example.com NAS and Weather' \
SYNO_SCHEME=http \
SYNO_HOSTNAME=localhost \
SYNO_PORT=5000 \
  /volume1/docker/ws2000-dashboard/acme-client/acme.sh \
    --deploy \
    --deploy-hook synology_dsm \
    -d nas.example.com \
    --home /volume1/docker/ws2000-dashboard/acme-client \
    --config-home /volume1/docker/ws2000-dashboard/acme-data \
    --cert-home /volume1/docker/ws2000-dashboard/acme-certs
```

The successful deployment stores the hook settings for later renewals. Create a root-owned renewal wrapper with mode `700` that runs:

```sh
/volume1/docker/ws2000-dashboard/acme-client/acme.sh \
  --cron \
  --home /volume1/docker/ws2000-dashboard/acme-client \
  --config-home /volume1/docker/ws2000-dashboard/acme-data \
  --cert-home /volume1/docker/ws2000-dashboard/acme-certs
```

Schedule the wrapper as `root` in **Control Panel → Task Scheduler** every six hours. Current `acme.sh` releases follow the certificate authority's suggested renewal window and skip runs that are not yet due. Log output to a root-readable file, rotate it, and confirm a manual run reports the next renewal time without exposing the PAT.

#### Assign the certificate and portal hostname

After the first import:

1. Open **Control Panel → Security → Certificate → Settings** (called **Configure** on some releases).
2. Assign the same SAN certificate to **DSM Desktop Service** and the dashboard's **Web Station portal**. Leave unrelated services on their existing certificates unless they also need these names.
3. In **Web Station → Web Portal**, edit the dashboard portal and set its hostname to `weather.example.com` with HTTP port 80 and HTTPS port 443.
4. Access DSM as `https://nas.example.com:5001` and the dashboard as `https://weather.example.com`. A certificate cannot validate an IP-address URL or an old local alias that is not listed in its SANs.

Renewal imports should update the certificate with the same DSM description and preserve these service assignments. Check the assignments after major DSM upgrades.

#### Enable the protected loopback design

Complete [administrator authentication](AUTHENTICATION.md), then use these values in `.env`:

```dotenv
DASHBOARD_PORT=127.0.0.1:3000
ADMIN_AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH_FILE=/app/secrets/admin-password.hash
ADMIN_SESSION_TTL_MINUTES=480
ADMIN_TRUST_PROXY=true
TLS_ENABLED=false
```

Recreate the application after changing `.env`:

```sh
chmod 600 .env
/usr/local/bin/docker compose up -d --force-recreate
```

DSM owns TLS; Node continues serving HTTP only on the NAS loopback interface. This is intentional.

#### Verify the finished setup

From a LAN client:

```sh
curl --fail https://weather.example.com/api/health
curl --fail https://weather.example.com/api/auth/status
curl --connect-timeout 3 http://192.168.1.10:3000/api/health
```

Expected results:

- the HTTPS health request succeeds;
- authentication status reports `"enabled":true`, `"secure":true`, and `"requiresHttps":false`;
- `/admin.html` redirects to `/login.html` until authenticated; and
- direct access to the private NAS address on port 3000 fails.

On the NAS, `docker port ws2000-dashboard 3000/tcp` should show only `127.0.0.1:3000`. The local upstream health check should still succeed at `http://127.0.0.1:3000/api/health`.

Optionally confirm that no public service records or stale challenges remain:

```sh
dig +short A weather.example.com @1.1.1.1
dig +short AAAA weather.example.com @1.1.1.1
dig +short TXT _acme-challenge.weather.example.com @1.1.1.1
dig +short TXT _acme-challenge.nas.example.com @1.1.1.1
```

All four commands should return no records after issuance cleanup. The authoritative NS and SOA records for `example.com` remain public as normal.

#### DNS-01 troubleshooting

- **`invalid domain` or `Error adding TXT record`:** confirm the domain uses the expected authoritative nameservers, the credential belongs to the owning account, and the hook uses the correct Bearer or legacy authentication format.
- **GoDaddy HTTP `401`:** replace an expired, revoked, malformed, or wrong-environment token. Re-enter it interactively instead of copying labels or surrounding whitespace.
- **GoDaddy HTTP `403`:** add the minimum domain-read and DNS-update scopes or verify account eligibility.
- **Certificate imported but the browser still shows Synology's certificate:** assign it explicitly to DSM and the Web Station portal, then use a hostname present in the SAN list.
- **Authentication status says `"secure":false`:** recreate the container after setting `ADMIN_TRUST_PROXY=true`, confirm DSM sends `X-Forwarded-Proto: https`, and keep port 3000 loopback-only.
- **Renewal succeeds but DSM keeps the old certificate:** ensure the deployment hook uses the same `SYNO_CERTIFICATE` description as the original import and still has `SYNO_USE_TEMP_ADMIN=1` plus `SYNO_LOCAL_HOSTNAME=1` saved.

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
