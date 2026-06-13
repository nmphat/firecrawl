#!/bin/bash
# PM2 wrapper for firecrawl docker compose
# Starts containers detached, then tails API logs for PM2 to monitor
cd /home/phat/stack/firecrawl
docker compose up -d
docker compose logs -f api
