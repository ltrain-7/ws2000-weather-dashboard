# Administrator authentication

The dashboard can remain readable without a login while the administration page and every `/api/admin` endpoint require a username and password. Authentication is disabled by default so existing private installations are not locked out during an update.

## Security model

- Passwords are never stored. The setup command produces a salted, memory-hard scrypt hash using Node's built-in cryptography.
- The browser receives a random session identifier in a `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookie.
- Sessions exist only in server memory. A logout, password change, container restart, or update invalidates all sessions.
- State-changing administration requests require both a valid session and a per-session CSRF token.
- Repeated login failures are delayed and rate limited.
- Login, logout, and administration responses are marked `no-store` and are never placed in the service-worker cache.
- Login is rejected unless Node is using native TLS or a specifically trusted reverse proxy reports HTTPS.

Authentication protects the administration area, but it does not replace HTTPS. Never enter the administrator password through a plain `http://` address.

## Generate a password hash

Run this from the project directory after pulling an image that includes authentication support:

```sh
docker compose run --rm ws2000-dashboard node scripts/hash-admin-password.js
```

The command prompts twice without echoing the password and prints a line beginning with `ADMIN_PASSWORD_HASH=`. It enforces a minimum length of 12 characters. Use a unique password or passphrase.

Do not pass the password as a command-line argument, place it in shell history, or store the plaintext password in `.env`.

## Synology DSM with HTTPS reverse proxy

DSM should terminate TLS and proxy to a loopback-only container port. Complete the certificate and reverse-proxy setup in [HTTPS and TLS setup](HTTPS.md), then edit `.env`:

```dotenv
DASHBOARD_PORT=127.0.0.1:3000
ADMIN_AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH='scrypt$...paste-the-complete-generated-value...'
ADMIN_SESSION_TTL_MINUTES=480
ADMIN_TRUST_PROXY=true
TLS_ENABLED=false
```

Keep the single quotes around the hash because Compose otherwise interprets dollar signs. `ADMIN_TRUST_PROXY=true` is safe only when port 3000 is bound to `127.0.0.1` and DSM is the only path to the app.

Recreate the container:

```sh
chmod 600 .env
docker compose up -d --force-recreate
```

Open the HTTPS hostname, choose **Administration**, and sign in. Direct access to `http://NAS-IP:3000` should no longer be possible when the loopback binding is active.

## Raspberry Pi or Linux

Choose one TLS pattern:

- **Caddy or another local reverse proxy:** bind `DASHBOARD_PORT=127.0.0.1:3000`, set `ADMIN_TRUST_PROXY=true`, and leave `TLS_ENABLED=false`.
- **Native Node TLS:** set `TLS_ENABLED=true`, configure the certificate paths, and leave `ADMIN_TRUST_PROXY=false`.

The same scrypt hash works across amd64, ARM64, and ARMv7 systems and does not require a native authentication add-on.

## Optional read-only hash file

Instead of placing the hash in `.env`, store only the generated `scrypt$...` value in `secrets/admin-password.hash`:

```sh
mkdir -p secrets
chmod 700 secrets
chown 1000:1000 secrets
chmod 600 secrets/admin-password.hash
chown 1000:1000 secrets/admin-password.hash
```

Then configure:

```dotenv
ADMIN_PASSWORD_HASH_FILE=/app/secrets/admin-password.hash
```

Remove or comment out `ADMIN_PASSWORD_HASH`. The Compose configuration mounts `secrets/` read-only inside the container, and the directory is excluded from Git.

## Change or reset the password

1. Generate a new hash with the setup command.
2. Replace the old hash in `.env` or the hash file.
3. Run `docker compose up -d --force-recreate`.

Recreating the container immediately invalidates every existing administrator session.

## Disable authentication

Set `ADMIN_AUTH_ENABLED=false` and recreate the container. This makes the administration page and maintenance APIs available without a login, so use it only on a trusted, isolated network.

## Troubleshooting

### “Administrator login requires HTTPS”

Use the HTTPS reverse-proxy hostname. For DSM, confirm all three settings:

- `DASHBOARD_PORT=127.0.0.1:3000`
- `ADMIN_TRUST_PROXY=true`
- the reverse-proxy source is HTTPS and its destination is `http://127.0.0.1:3000`

Do not work around this protection by exposing port 3000 or transmitting the password over HTTP.

### Container refuses to start

When `ADMIN_AUTH_ENABLED=true`, the app deliberately fails closed if the hash is missing, unreadable, or malformed. Check the quoted `.env` value or the ownership and permissions of the mounted hash file.

### Login works, then ends after an update

This is expected. Sessions are kept in memory and all users must sign in again after a container restart or update.
