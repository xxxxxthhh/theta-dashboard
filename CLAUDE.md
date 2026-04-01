# Theta Dashboard — Agent Rules

## Data Operations

See `OPERATIONS.md` for data formats and workflows. Do not duplicate here.

## Build Rules

- After modifying `src/*.js` or `template.html`, you MUST manually trigger a CI rebuild:
  ```bash
  gh workflow run build.yml
  ```
  CI only auto-triggers on theta-data updates. Dashboard source changes do NOT trigger a rebuild.

- For local builds, set the environment variable first:
  ```bash
  export DASHBOARD_PASS="password"
  node src/build.js
  ```

## Security

- Never commit `portfolio_data.json` (already in .gitignore)
- Never hardcode `DASHBOARD_PASS` in any file
- Never commit `.env` or any file containing secrets
