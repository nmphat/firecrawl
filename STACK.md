# Stack notes

Fork-only notes for `nmphat/firecrawl`, branch `stack-customizations`.
They live here rather than in `README.md` so that rebasing onto
`firecrawl/firecrawl` never conflicts on the upstream readme.

## What this fork changes

`apps/playwright-service-ts` renders pages with
[CloakBrowser](https://github.com/CloakHQ/cloakbrowser) instead of stock
Playwright Chromium, which gets through bot detection that the stock browser
does not. Three consequences:

- `playwright` is replaced by `cloakbrowser` plus `playwright-core` (kept only
  for its types).
- The package is ESM (`"type": "module"`), because `cloakbrowser` is ESM-only,
  so the container runs `tsx api.ts` rather than building to `dist/`.
- The image predownloads the stealth Chromium as the `node` user, so the cache
  sits in a home directory the runtime user can read.

`docker-compose.override.yaml` publishes the API on 3092 and sets
`restart: unless-stopped`. `docker-compose.yaml` itself is left as upstream
ships it, so the images build from source on any fresh host.

Everything else is upstream.

## Run

```bash
cp .env.example .env    # then edit
docker compose up -d --build
```

`USE_DB_AUTHENTICATION` must be `0`, not `false` — the zod schema rejects the
string and the API crashes on startup.

## Ports

| Port | Description |
|------|-------------|
| 3092 | Firecrawl API (host) → 3002 in the container |

## Process management

The homelab wraps this in PM2 via `pm2-start.sh`. The Oracle VPS does not:
compose's `restart: unless-stopped` already covers it there, so nothing
supervises the supervisor.

## Check it works

```bash
curl -X POST http://localhost:3092/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

## Staying current

```bash
git fetch upstream
git rebase upstream/main
```

Expect conflicts only in `apps/playwright-service-ts` — that is the whole
footprint of this fork.
