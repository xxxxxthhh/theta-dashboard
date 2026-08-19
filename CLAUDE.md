# Theta Dashboard — Agent Rules

## Data Operations

See `OPERATIONS.md` for data formats and workflows. Do not duplicate here.

## Build Rules

- Pushing `src/*.js`, `template.html`, tests, or the build workflow to `main`
  automatically runs tests and rebuilds the encrypted dashboard. No separate manual
  dispatch is required.

- For local builds, set the environment variable first:

  ```bash
  export DASHBOARD_PASS="password"
  export THETA_DATA_DIR="../theta-data"   # optional if theta-data is not in the default sibling path
  node src/build.js
  ```

## Security

- Never commit `portfolio_data.json` (already in .gitignore)
- Current positions must come from `published/ibkr-latest.json`; never fall back to
  `portfolio_data.json` when the broker read model is missing or invalid.
- Never hardcode `DASHBOARD_PASS` in any file
- Never commit `.env` or any file containing secrets
