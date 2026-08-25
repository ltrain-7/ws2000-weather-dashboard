# Contributing

Thanks for helping improve the WS-2000 Weather Dashboard.

## Before opening a change

- Search existing issues and pull requests.
- Never include Ambient API keys, station MAC addresses, weather databases, logs containing secrets, or private network details.
- For security vulnerabilities, follow `SECURITY.md` instead of opening a public issue.

## Development workflow

1. Fork the repository and create a focused branch.
2. Make the smallest practical change.
3. Run JavaScript syntax checks and validate all edited YAML and shell scripts.
4. For UI changes, test Latest, 7D, 30D, 90D, 180D, and date-picker views.
5. For storage changes, verify that `/app/data/weather.db` remains persistent.
6. Open a pull request using the template and explain how the change was tested.

All required GitHub checks must pass before merge. Dependencies and actions should remain locked or pinned; do not merge a major Socket.IO client update without validating Ambient Weather realtime compatibility.
