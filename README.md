# Firecrawl

Self-hosted web scraping API. Converts web pages to clean markdown, extracts structured data, and handles JS-rendered sites.

## Setup

```bash
# Copy and edit env file
cp .env.example .env
vim .env

# Start (Docker containers + PM2 log monitoring)
bash pm2-start.sh
```

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | API server port (default: 3092) |
| `HOST` | Bind address (default: 0.0.0.0) |
| `USE_DB_AUTHENTICATION` | Auth mode -- use `0` for local-only |
| `BULL_AUTH_KEY` | Internal queue auth key |

## Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 3092 | HTTP | Firecrawl API |

## Architecture

```
pm2-start.sh
    |
    docker compose up -d (all containers)
    docker compose logs -f api (PM2 monitors API logs)
    
Containers: api, worker, playwright-service, redis, rabbitmq, postgres
```

## Git

- **Repo**: `nmphat/firecrawl` (fork of `firecrawl/firecrawl`)
- **Branch**: `stack-customizations`
- **Customizations**: PM2 wrapper, playwright-service simplification
- **Update method**: `stack-update.sh` (auto every 6h)

## Update

```bash
# Auto (via stack cron every 6h)
~/stack/scripts/stack-update.sh

# Manual
git pull origin stack-customizations
docker compose up -d --build
```

## Usage

```bash
# Scrape a page
curl -X POST http://localhost:3092/v1/scrape   -H "Content-Type: application/json"   -d '{"url": "https://example.com", "formats": ["markdown"]}'

# Search
curl -X POST http://localhost:3092/v1/search   -H "Content-Type: application/json"   -d '{"query": "your search query"}'
```

## Troubleshooting

### Zod validation crash on startup

`USE_DB_AUTHENTICATION` may not accept string `"false"`. Use `"0"` instead.

### Containers not starting

Check Docker: `docker compose ps` and `docker compose logs api`
