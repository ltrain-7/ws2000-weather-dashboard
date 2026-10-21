# WS-2000 dashboard security review

Reviewed `main` at commit `2731c8f4cc4b9f731b12bd9861c50b2effe17640`, application version 1.10.2, on October 21, 2026. This was a source review and local testing; no deployed service was probed and no source changes were made.

## 1. High, conditional: root updater follows symlinks from container-writable storage

Location: `scripts/update.sh:85–92`; related configuration: `docker-compose.yml:16` and the root scheduled-update instructions in `README.md:280–283`.

The updater writes to the predictable `data/deployment.json.tmp` using shell redirection, then runs `chmod 664` and `chown 1000:1000` on that path. All three operations follow symlinks. The application container runs as UID 1000 and can write the bind-mounted data directory. An attacker who has already obtained filesystem write access as that application user can plant a symlink at this path pointing to a host file outside the bind mount. During the next successful root-run update, the host resolves the link, overwrites the target with deployment JSON, changes its permissions, and transfers ownership to UID 1000. The target needs to be writable by the updater; it does not need to be accessible inside the container.

Impact: host-file corruption and unauthorized permission/ownership changes across the container boundary. This requires prior application/container filesystem compromise or another way to modify `data/`, plus a subsequent update; it is not a standalone remote exploit.

Validation: ran the real updater with a mocked Docker executable and a symlink pointing to a disposable file outside the fixture's data directory. The file was overwritten with metadata and chmodded. The test ran as the current user, not root; root impact follows from the documented deployment and the same file operations.

Fix: keep privileged metadata staging in a root-owned directory outside container-writable storage, create temporary files exclusively, and publish through a design that does not follow attacker-controlled paths. Prefer a separate host-owned metadata directory mounted read-only into the container. A symlink check alone is insufficient because it introduces a check/use race.

## 2. Medium: concurrent login attempts bypass the attempt limit

Location: `src/auth.js:170–180`.

`authenticate()` checks the limiter, awaits password verification, and records the attempt only after verification fails. Multiple requests from one client can therefore all pass the check before the first verification completes. Every admitted request queues an expensive scrypt operation. The subsequent delay does not prevent that work.

Impact: an unauthenticated client able to reach the HTTPS login route can submit a large concurrent batch, exceeding the intended five-attempt window and consuming password-verification CPU/thread-pool capacity. A successful guess in an already admitted batch can still create a session after other failures have triggered the limiter.

Validation: a controlled asynchronous verifier held password checks in flight; 20 simultaneous attempts from one client all reached verification despite the default five-attempt limit. After they completed, the next attempt was blocked. This demonstrates the scheduling flaw without performing a password attack or load test.

Fix: reserve/count an attempt synchronously before awaiting verification, and bound total and per-client in-flight password checks. Account for successful requests without resetting the state of unrelated pending attempts. Add a concurrency regression test.

## 3. Medium: public forecast requests bypass caching while a refresh is in flight

Location: `src/forecast.js:54–70`; public entry point: `src/server.js:316–329`.

The forecast cache and failure backoff are populated only after a provider request completes. There is no shared pending promise or request-rate limit on `/api/forecast`. When the cache is cold or expired, every concurrent unauthenticated request starts a separate Open-Meteo request. The failure backoff cannot constrain the initial concurrent batch.

Impact: a client reaching the dashboard can amplify requests against the forecast provider and consume application sockets, memory, and provider quota, potentially making forecasts unavailable. This applies when forecasting has a valid location and its cache is cold or expired.

Validation: with a controlled provider mock, 20 simultaneous `getForecast()` calls produced 20 outbound calls before any completed. No requests were sent to Open-Meteo.

Fix: share one pending refresh promise among callers, clear it in `finally`, and apply a bounded request/concurrency policy to the public route. Add a concurrent-cache-miss regression test.

## Validation and limits

- All 35 repository tests passed, including the authentication HTTP integration test.
- Three additional isolated local reproductions confirmed the behaviors above. Dependency injection was used for password-verification scheduling and forecast requests; a mock Docker executable was used to exercise the real updater.
- Repository checkout remained unmodified.
- No live deployment assessment, container-image scan, or current dependency advisory audit was performed. The dependency lockfile and security workflow were inspected; that is not equivalent to a fresh dependency audit.
- Authentication being disabled by default is explicitly documented and was not counted as a new vulnerability. Public weather endpoints are also intentional. No direct remote code execution or administrator-session bypass was established in this review.
