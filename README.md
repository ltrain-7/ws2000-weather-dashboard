# Portable WS-2000 Weather Dashboard

A private, self-hosted dashboard for Ambient Weather WS-2000 stations. It keeps API keys on the server, receives live observations, stores history in SQLite, and provides daily plus 7/30/90/180-day trend charts.

The package runs on Raspberry Pi, small Linux systems, mini PCs, and NAS devices using Docker Compose. It contains no API keys, station identifiers, or weather history.

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

Check service health with:

```sh
docker compose ps
curl http://127.0.0.1:3000/api/health
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

For a consistent offline backup:

```sh
docker compose stop
tar -czf ws2000-weather-data-backup.tgz data
docker compose start
```

### Restore

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
| `CONTAINER_CPU_LIMIT` | Docker CPU allowance, such as `1.0` |
| `LOG_MAX_SIZE` | Maximum size of each Docker log file |
| `LOG_MAX_FILES` | Number of rotated Docker log files |

`SQLITE_DB_PATH` is set safely by `docker-compose.yml` and normally should not be added to `.env`.

## Updating

Run the guarded updater manually:

```sh
./scripts/update.sh
```

The updater pulls the `stable` image, stops the app briefly for a consistent SQLite backup, starts the new version, checks `/api/health`, and rolls back to the prior image if the health check fails. Backups are stored under `backups/`.

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
- This dashboard has no login screen. Use it on a trusted home network.
- Do not expose port 3000 directly to the public internet. Use an authenticated reverse proxy or VPN if remote access is required.
- Docker logs are rotated to protect small SD cards from unbounded log growth.

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
