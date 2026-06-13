#!/bin/bash
# TDD RED: Test that Firecrawl stack runs with CloakBrowser
# These tests should FAIL until the stack is properly configured.

set -e
PASS=0
FAIL=0

pass() { echo "✅ PASS: $1"; ((PASS++)); }
fail() { echo "❌ FAIL: $1"; ((FAIL++)); }

echo "=== Firecrawl Stack Tests ==="
echo ""

# Test 1: All containers running
echo "--- Test: All containers running ---"
RUNNING=$(docker compose -f /home/phat/stack/firecrawl/docker-compose.yaml ps --format json 2>/dev/null | jq -r 'select(.State == "running") | .Name' | wc -l)
if [ "$RUNNING" -ge 4 ]; then
    pass "All containers running ($RUNNING)"
else
    fail "Expected 4+ containers running, got $RUNNING"
fi

# Test 2: Playwright service health endpoint
echo "--- Test: Playwright service health ---"
HEALTH=$(curl -sf http://localhost:3003/health 2>/dev/null)
if echo "$HEALTH" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
    pass "Playwright service healthy"
else
    fail "Playwright service not healthy: $HEALTH"
fi

# Test 3: CloakBrowser binary present in playwright container
echo "--- Test: CloakBrowser binary in container ---"
CB_PATH=$(docker exec firecrawl-playwright-service-1 sh -c 'which cloakbrowser-chromium 2>/dev/null || find /usr -name "chrome" -path "*/cloakbrowser/*" 2>/dev/null | head -1' 2>/dev/null)
if [ -n "$CB_PATH" ]; then
    pass "CloakBrowser binary found: $CB_PATH"
else
    fail "CloakBrowser binary not found in playwright container"
fi

# Test 4: Firecrawl API responds
echo "--- Test: Firecrawl API responds ---"
API_RESP=$(curl -sf http://localhost:3002/v1/scrape -X POST -H 'Content-Type: application/json' -d '{"url":"https://example.com"}' 2>/dev/null)
if echo "$API_RESP" | jq -e '.success == true' > /dev/null 2>&1; then
    pass "Firecrawl API scrape works"
else
    fail "Firecrawl API scrape failed: ${API_RESP:0:200}"
fi

# Test 5: Redis accessible
echo "--- Test: Redis accessible ---"
if docker exec firecrawl-redis-1 redis-cli ping 2>/dev/null | grep -q PONG; then
    pass "Redis responding"
else
    fail "Redis not responding"
fi

# Test 6: RabbitMQ healthy
echo "--- Test: RabbitMQ healthy ---"
if docker exec firecrawl-rabbitmq-1 rabbitmq-diagnostics -q check_running 2>/dev/null | grep -q "healthy"; then
    pass "RabbitMQ healthy"
else
    fail "RabbitMQ not healthy"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
