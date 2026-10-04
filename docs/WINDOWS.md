# Windows with Docker Desktop

Run the existing Linux image on a Windows PC using Docker Desktop's WSL 2 backend and **Linux containers** mode. Node.js, Git Bash, and a separate Linux shell are not required. The scripts work with Windows PowerShell 5.1 and PowerShell 7.

Use a Windows version and hardware supported by [Docker Desktop's current requirements](https://docs.docker.com/desktop/setup/install/windows-install/). Windows 11 on an x64 PC is the recommended starting point. Docker Desktop is not supported on Windows Server; this guide does not cover native Windows containers or a native Node.js installation.

## Install and start

1. Install Docker Desktop from the official link above, following its WSL 2 instructions. Restart Windows if requested, then start Docker Desktop and wait until its engine is running. Select Linux containers if you previously used Windows containers.
2. Download this repository's source ZIP and extract it into a local directory such as `C:\weather\ws2000-weather-dashboard`. Avoid network shares and OneDrive/cloud-synced folders for the live SQLite database.
3. Open PowerShell in the extracted directory and run:

   ```powershell
   .\scripts\setup.ps1
   notepad .env
   ```

   Enter your Ambient application and API keys in `.env`. Keep this file private. Set `TZ` to your IANA timezone, such as `America/New_York`. Setup uses the `pi-performance` profile by default and preserves any existing `.env`.

   If Windows marks downloaded scripts as blocked, review them and use `Unblock-File` on the specific script you intend to run. Follow your organization's execution policy; these scripts do not change it.

4. Start the dashboard:

   ```powershell
   docker compose up -d
   docker compose ps
   Invoke-RestMethod http://localhost:3000/api/health
   ```

5. Open <http://localhost:3000> and <http://localhost:3000/admin.html>.

New PowerShell setups use `DASHBOARD_PORT=127.0.0.1:3000`, so only this PC can connect. To deliberately allow trusted LAN devices, change the setting to `DASHBOARD_PORT=3000`, recreate the container with `docker compose up -d`, and permit the port only on the appropriate private Windows Firewall network. Do not forward it from your router. See [HTTPS](HTTPS.md) and [administrator authentication](AUTHENTICATION.md) before exposing administration to other devices.

Docker stores weather history in the project's `data` folder and backups in `backups`, using the same Compose bind mounts as Linux. Keep these folders when replacing source files or updating. Restrict access to the project directory using Windows folder permissions. Do not run Linux `chmod` or `chown` commands against Windows files.

## Update

Run from PowerShell:

```powershell
.\scripts\update.ps1
```

The updater reads the image from the resolved Compose configuration (including `.env`), pulls it, skips unchanged images, stops the app for a consistent `weather-data-*.tgz` backup, verifies the archive, starts the new image, and waits for Docker's health check. It restarts the unchanged container if backup fails and rolls back to the previous image if deployment fails. Failed updates return an error and leave the previous deployment record intact. Updates do not automatically restore the database; retain the backup for recovery if needed.

After a healthy update, Administration shows the deployed image digest, revision, and time. The updater keeps at most 12 deployment archives and removes archives older than 90 days by default. Override these limits with `-BackupMaxFiles` and `-BackupRetentionDays`; zero disables that limit. Application-created `weather-*.db` backups are unaffected.

Scripts find the project relative to their own location, so paths with spaces and calls from another directory work. Use `-ProjectDir` for another standard project directory. The updater requires the standard local `data` and `backups` bind mounts; it refuses custom mounts instead of backing up the wrong directory. Run only one updater at a time; overlapping PowerShell runs are locked out.

## Scheduled updates and startup

Docker Desktop must be running for the dashboard or its updater to work. Enable Docker Desktop's sign-in startup option if desired. A sleeping or signed-out PC is not an always-on weather host.

For a weekly update, create a Windows Task Scheduler task under the same Windows account that runs Docker Desktop, using **Run only when user is logged on**:

- Program: `powershell.exe` (or `pwsh.exe` for PowerShell 7)
- Arguments: `-NoProfile -File "C:\weather\ws2000-weather-dashboard\scripts\update.ps1"`
- Start in: `C:\weather\ws2000-weather-dashboard`

Choose your preferred schedule. Do not use SYSTEM or an execution-policy bypass. The task's nonzero exit status indicates an update failure; inspect the container logs and backup before retrying.

## Backup and recovery

For application database snapshots, use Administration's backup and integrity-check actions. To create a manual offline archive:

```powershell
docker compose stop
tar -czf weather-data-manual.tgz data
docker compose start
```

Check `$LASTEXITCODE` after each command and keep the archive outside the live data folder. To restore an archive, stop the service, preserve the current `data` folder under another name, extract the archive into the project directory, and start the service. Never overwrite a running SQLite database or restore only its `-wal` or `-shm` file.

## Troubleshooting

- **Docker cannot connect:** start Docker Desktop and confirm `docker info` succeeds.
- **Wrong container OS:** `docker info --format '{{.OSType}}'` must print `linux`.
- **Port already in use:** set `DASHBOARD_PORT=127.0.0.1:3001` and recreate the container; browse to port 3001.
- **Files cannot be mounted or written:** keep the project on a local drive accessible to your Docker Desktop account and check Docker Desktop file-sharing settings and Windows folder permissions.
- **No readings:** check `.env`, then use `docker compose up -d --force-recreate`. Inspect `docker compose logs --tail=100 ws2000-dashboard` without publishing secrets.

CI tests setup and update success/failure paths on Windows PowerShell 5.1 and PowerShell 7, plus real Windows tar handling. Linux image health checks run separately on AMD64, ARM64, and ARMv7. A complete Docker Desktop/WSL installation still needs a hands-on Windows smoke test.
