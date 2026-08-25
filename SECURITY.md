# Security Policy

## Supported versions

Security fixes are provided for the latest published release. Upgrade to the current `stable` container image before reporting an issue that may already be fixed.

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials, station identifiers, or private network details in a public issue.

Use [GitHub private vulnerability reporting](https://github.com/ltrain-7/ws2000-weather-dashboard/security/advisories/new). Include the affected version, reproduction steps, impact, and any suggested mitigation. You should receive an initial response within three business days.

If private reporting is unavailable, open a public issue containing no sensitive or exploit details and ask the maintainer for a private contact channel.

## Operational security

This dashboard is intended for a trusted home network. Keep `.env` private, do not expose port 3000 directly to the internet, and use an authenticated reverse proxy or VPN for remote access.
