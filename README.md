# Portable WS-2000 Weather Dashboard

A private, self-hosted dashboard for Ambient Weather WS-2000 stations. It keeps API keys on the server, receives live observations, stores history in SQLite, and provides daily plus 7/30/90/180-day trend charts.

It also provides station-health warnings, previous-period comparisons, calendar rainfall totals, verified automatic backups, an installable mobile experience, and optional built-in authentication for its private administration page. The responsive dashboard prioritizes current conditions, progressively reveals secondary readings and history options, provides keyboard-accessible insight tabs, and includes chart tooltips plus an accessible data table.

The package runs on Raspberry Pi, small Linux systems, mini PCs, and NAS devices using Docker Compose. It contains no API keys, station identifiers, or weather history.

Licensed under the [MIT License](LICENSE). Security reports should follow [SECURITY.md](SECURITY.md), and proposed changes should follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Supported hardware

- Raspberry Pi Zero 2 W running a 64-bit OS: use `pi-zero-2`
- Raspberry Pi 3/4 with at least 1 GB RAM: use `pi-standard`
- Raspberry Pi 4/5 with at least 2 GB RAM, mini PC, or NAS: use `pi-performance`
- x86-64 or ARM64 Linux with Docker Compose

The original Raspberry Pi Zero/Zero W uses ARMv6 and is not recommended. Raspberry Pi OS Lite 64-bit is the best low-resource choice.

## Quick start

1. Install Docker Engine and the Docker Compose plugin.
2. Extract this package and enter its directory.
3. Select a hardware profile:

   ```sh
   ./scripts/setup.sh pi-standard
   ```

4. Edit `.env` and replace the two placeholder values:

   ```text
   AMBIENT_APPLICATION_KEY=...
   AMBIENT_API_KEY=...
   ```

   Create the keys at <https://ambientweather.net/account>.

5. Start the dashboard using the published multi-architecture image:

   ```sh
   docker compose up -d
   ```

6. Open `http://RASPBERRY-PI-IP:3000`.

Open `/admin.html` to view application, connection, station, storage, backup, and backfill status. The page never returns Ambient API key values.

For HTTPS on Synology DSM or Raspberry Pi/Linux, see [HTTPS and TLS setup](docs/HTTPS.md).
To protect the administration page and every maintenance API with a secure login, see [Administrator authentication](docs/AUTHENTICATION.md).

Check service health with:

```sh
docker compose ps
curl http://127.0.0.1:3000/api/health
```

## Synology DSM 7.2–7.4 installation

These steps are validated for DSM 7.2–7.4 with **Container Manager** installed from Package Center.

> **DSM 8 compatibility:** DSM 8 was not available in Synology's official downloads when this guide was last reviewed, so it has not been validated. The dashboard should remain compatible if DSM 8 retains Container Manager, Compose projects, bind-mounted folders, and scheduled tasks. Check the [DSM release notes](https://www.synology.com/en-us/releaseNote/DSM) and this repository's issues before upgrading, then confirm the Docker path and UI labels because Synology may change them.

1. In **File Station**, create `/volume1/docker/ws2000-dashboard`.
2. Download this repository's source archive from GitHub and extract its contents into that folder. `docker-compose.yml`, `.env.example`, `scripts/`, `public/`, and `src/` should be directly inside `ws2000-dashboard`, not inside an extra nested folder.
3. Copy `.env.example` to `.env`. In File Station, make sure `.env` is not shared publicly. Edit it and set at least:

   ```text
   AMBIENT_APPLICATION_KEY=your-application-key
   AMBIENT_API_KEY=your-api-key
   TZ=America/New_York
   ```

   Create the Ambient keys at <https://ambientweather.net/account>. Do not put real keys in GitHub or screenshots.

4. Create the persistent folders `data`, `backups`, `certs`, and `secrets` inside `/volume1/docker/ws2000-dashboard`. If created over SSH as root, run `chown -R 1000:1000 data backups secrets` from the project folder so the container can write data and read an optional administrator hash file. Keep `secrets` private with `chmod 700 secrets`.
5. In **Container Manager → Project → Create**, choose:

   - Project name: `ws2000-dashboard`
   - Path: `/volume1/docker/ws2000-dashboard`
   - Source: use the existing `docker-compose.yml`

6. Build/start the project. The public multi-architecture image works on supported Intel/AMD and ARM Synology models. No GitHub login is required.
7. Open `http://SYNOLOGY-IP:3000` on the local network. Container Manager should report the container as healthy after roughly 20–60 seconds.

### DSM SSH alternative

If SSH is enabled, run these commands as an administrator with root privileges. DSM may not include `/usr/local/bin` in non-interactive command paths, so the absolute Docker path is intentional:

```sh
cd /volume1/docker/ws2000-dashboard
cp .env.example .env
mkdir -p data backups certs secrets
chown -R 1000:1000 data backups secrets
chmod 700 secrets
chmod 600 .env
# Edit .env and add the two Ambient keys before continuing.
/usr/local/bin/docker compose up -d
/usr/local/bin/docker compose ps
wget -qO- http://127.0.0.1:3000/api/health
```

If SQLite reports a permissions error:

```sh
chown -R 1000:1000 /volume1/docker/ws2000-dashboard/data
chmod 750 /volume1/docker/ws2000-dashboard/data
/usr/local/bin/docker compose restart
```

Allow TCP port `3000` in **Control Panel → Security → Firewall** only for trusted local-network ranges. Do not expose the dashboard directly to the internet.

To backfill the preceding 90 days after the station connects:

```sh
/usr/local/bin/docker exec ws2000-dashboard npm run backfill -- 90
```

## Hardware profiles

| Profile | Typical device | Memory cap | History | Chart points | REST fallback |
| --- | --- | ---: | ---: | ---: | ---: |
| `pi-zero-2` | Pi Zero 2 W, 512 MB | 160 MB | 90 days | 240 | 5 minutes |
| `pi-standard` | Pi 3/4, 1 GB+ | 256 MB | 365 days | 480 | 2 minutes |
| `pi-performance` | Pi 4/5, mini PC, NAS | 384 MB | 730 days | 720 | 1 minute |

The realtime feed remains enabled for every profile. The polling interval controls only the REST fallback. Lower chart-point and retention values reduce SQLite query work and disk use.

To switch profiles, stop the service, preserve your two API key lines, replace `.env` from the desired file in `profiles/`, restore the keys, and run `docker compose up -d`.

## Historical backfill

After the dashboard has connected to a station, optionally backfill older readings:

```sh
docker exec ws2000-dashboard npm run backfill -- 90
```

Replace `90` with 1–365 days. Ambient returns at most 288 readings per request and enforces rate limits, so a 90-day backfill can take several minutes. The script resumes from the oldest stored reading and safely upserts duplicates.

## Data persistence

SQLite is always stored at `/app/data/weather.db` inside the container and bind-mounted to `./data` on the host. Do not change `SQLITE_DB_PATH` to a relative path; relative paths can place the database outside the persistent mount.

If the container reports a read-only database on Linux:

```sh
sudo chown -R 1000:1000 data
chmod 750 data
docker compose restart
```

### Backup

The application creates a consistent, integrity-checked SQLite snapshot under `backups/` every 24 hours by default. Use **Admin → Create backup** for an immediate snapshot and **Admin → Check database** to verify the active database. Application backups named `weather-*.db` are pruned according to `BACKUP_RETENTION_DAYS` and `BACKUP_MAX_FILES`.

The guarded image updater separately creates a compressed `weather-data-*.tgz` backup before changing containers. Keeping both mechanisms provides a recent database snapshot plus a pre-update rollback point.

For a consistent offline backup:

```sh
docker compose stop
tar -czf ws2000-weather-data-backup.tgz data
docker compose start
```

### Restore

To restore an application-created snapshot, stop the container before replacing the database:

```sh
docker compose stop
cp data/weather.db data/weather.db.before-restore
cp backups/weather-YYYYMMDDTHHMMSSZ.db data/weather.db
sudo chown 1000:1000 data/weather.db
docker compose start
```

Retain `weather.db.before-restore` until the dashboard and `/api/health` have been verified. Do not restore only the SQLite `-wal` or `-shm` files.

To restore a compressed updater or manual archive:

```sh
docker compose down
mv data data.before-restore
tar -xzf ws2000-weather-data-backup.tgz
sudo chown -R 1000:1000 data
docker compose up -d
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `AMBIENT_APPLICATION_KEY` | Required Ambient application key |
| `AMBIENT_API_KEY` | Required Ambient user API key |
| `AMBIENT_API_KEYS` | Optional comma-separated user keys |
| `AMBIENT_DEVICE_MAC` | Optional station MAC to select by default |
| `TZ` | Container timezone, such as `America/New_York` |
| `DASHBOARD_PORT` | Host port; defaults to `3000` |
| `WS2000_IMAGE` | Published container image; defaults to the `stable` GHCR release |
| `AMBIENT_POLL_INTERVAL_MS` | REST fallback interval; minimum 30 seconds |
| `AMBIENT_HISTORY_LIMIT` | Recent readings requested; maximum 288 |
| `HISTORY_MAX_POINTS` | Maximum points returned for a long-range chart |
| `LIVE_HISTORY_LIMIT` | In-memory fallback readings; maximum 288 |
| `HISTORY_RETENTION_DAYS` | SQLite retention; `0` keeps everything |
| `CONTAINER_MEMORY_LIMIT` | Docker memory limit, such as `256m` |
| `LOG_MAX_SIZE` | Maximum size of each Docker log file |
| `LOG_MAX_FILES` | Number of rotated Docker log files |
| `STATION_STALE_MINUTES` | Minutes without a reading before station health changes to warning |
| `BACKUP_INTERVAL_HOURS` | Hours between verified SQLite backups; `0` disables scheduling |
| `BACKUP_RETENTION_DAYS` | Maximum age of application-created backups; `0` disables age pruning |
| `BACKUP_MAX_FILES` | Maximum application-created backups retained; `0` disables count pruning |
| `ADMIN_AUTH_ENABLED` | Protects the administration page and APIs; defaults to `false` |
| `ADMIN_USERNAME` | Administrator username; defaults to `admin` |
| `ADMIN_PASSWORD_HASH` | Quoted scrypt hash produced by `npm run auth:hash` |
| `ADMIN_PASSWORD_HASH_FILE` | Optional read-only hash file, such as `/app/secrets/admin-password.hash` |
| `ADMIN_SESSION_TTL_MINUTES` | Administrator session lifetime; defaults to 480 minutes |
| `ADMIN_TRUST_PROXY` | Trusts a local reverse proxy's HTTPS header; use only with a loopback port binding |
| `TLS_ENABLED` | Enables native Node HTTPS; defaults to `false` |
| `TLS_CERT_PATH` | Certificate chain inside the container; defaults to `/app/certs/fullchain.pem` |
| `TLS_KEY_PATH` | Private key inside the container; defaults to `/app/certs/privkey.pem` |

`SQLITE_DB_PATH` is set safely by `docker-compose.yml` and normally should not be added to `.env`.

## Updating

Run the guarded updater manually:

```sh
./scripts/update.sh
```

The updater pulls the `stable` image, stops the app briefly for a consistent SQLite backup, starts the new version, checks `/api/health`, and rolls back to the prior image if the health check fails. Backups are stored under `backups/`.

Updater backups are limited to 12 files and 90 days by default. Override either limit for a manual or scheduled run with `BACKUP_MAX_FILES` or `BACKUP_RETENTION_DAYS`; set a value to `0` to disable that limit.

### Ambient Weather API documentation monitoring

The weekly `Monitor Ambient Weather API docs` GitHub Actions workflow checks the latest commit in Ambient Weather's official [`ambient-weather/api-docs`](https://github.com/ambient-weather/api-docs) repository against `.github/ambient-api-docs.sha`. If the upstream documentation changes, it opens one GitHub issue with links to the old and new revisions. After reviewing compatibility, update the baseline SHA and close the issue.

### Weekly automatic updates on Synology

In DSM, open **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**. Run it as `root`, schedule it weekly, and use:

```sh
cd /volume1/docker/ws2000-dashboard && ./scripts/update.sh >> /volume1/docker/ws2000-dashboard/update.log 2>&1
```

### Weekly automatic updates on Raspberry Pi/Linux

Run `crontab -e` and add:

```cron
15 4 * * 1 cd /opt/ws2000-dashboard && ./scripts/update.sh >> update.log 2>&1
```

Adjust `/opt/ws2000-dashboard` to the project directory. This checks each Monday at 4:15 AM. No update occurs when the installed image is already current.

### Local development build

Developers can build from source instead of pulling GHCR:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The database survives updates and rebuilds because it lives in the host `data` directory.

## Security

- Keep `.env` private; never email or commit it.
- The browser never receives the Ambient keys.
- Built-in authentication can protect the administration page and maintenance APIs; it is disabled by default for upgrade compatibility. See [Administrator authentication](docs/AUTHENTICATION.md).
- Do not expose port 3000 directly to the public internet. Bind it to loopback behind DSM/Caddy or use a trusted LAN firewall rule.
- HTTPS protects credentials and session cookies in transit. Authentication does not make the public weather dashboard private; use a VPN or proxy-wide authentication if the whole site must be restricted.
- Docker logs are rotated to protect small SD cards from unbounded log growth.
- CI smoke-tests the published `amd64`, `arm64`, and `arm/v7` images under emulation. This improves Raspberry Pi confidence but does not replace validation on every physical Pi model and OS image.

## Mobile installation and offline behavior

The dashboard is a Progressive Web App. When served over trusted HTTPS, use the browser's **Install app** or **Add to Home Screen** command. It caches the interface and the last successful configuration, status, and station reading. Historical queries and maintenance actions still require a connection to the server.

Browsers require HTTPS for service workers except on `localhost`. A dashboard opened through a plain LAN IP such as `http://192.168.1.10:3000` continues to work normally but is not installable and cannot cache readings offline. Configure HTTPS using [HTTPS and TLS setup](docs/HTTPS.md).

## Analytics and station health

- The health banner warns when the latest packet is older than `STATION_STALE_MINUTES`, becomes offline after four times that interval, or reports a low outdoor battery.
- Enable **Compare previous period** to overlay the preceding day or rolling range as a dashed line and show summary differences.
- Rainfall totals use the maximum station daily counter for each local calendar day, preventing frequent observations from being double-counted. The dashboard shows today, the last seven days, the current month, the current year, and the wettest day in the analysis period.
- The administration page can start a 1–365 day Ambient history backfill. Progress remains visible while the server process is running.
- Raw station packet fields are kept off the main dashboard and remain available under **Administration → Advanced station fields**.

## Troubleshooting

### “Keys needed” appears

Confirm both key values in `.env`, then recreate the container:

```sh
docker compose up -d --force-recreate
```

### Dashboard works but history does not survive rebuilds

Check that the mount and database path are correct:

```sh
docker inspect ws2000-dashboard --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
docker exec ws2000-dashboard sh -c 'printf "%s\n" "$SQLITE_DB_PATH"'
```

The destination must be `/app/data`, and the path must be `/app/data/weather.db`.

### View logs

```sh
docker compose logs --tail=100 ws2000-dashboard
```

## API endpoints

- `GET /api/health`
- `GET /api/config`
- `GET /api/latest`
- `GET /api/history`
- `GET /api/storage`
- `GET /api/events`
