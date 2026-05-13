import { Counter, Histogram } from "prom-client";

export const firePdfAsyncSubmittedTotal = new Counter({
  name: "firecrawl_fire_pdf_async_submitted_total",
  help: "Fire-pdf /jobs submissions accepted (POST returned 200 or 202)",
  labelNames: ["lane"],
});

export const firePdfAsyncCompletedTotal = new Counter({
  name: "firecrawl_fire_pdf_async_completed_total",
  help: "Fire-pdf async jobs that reached a terminal status via GET",
  labelNames: ["terminal_status"],
});

// reason ∈ {http_404, http_503, http_429, http_5xx, http_4xx, network_error,
//           terminal_failed, terminal_expired, terminal_cancelled,
//           polling_timeout, gcs_upload_failed, gcs_download_failed}
export const firePdfAsyncFallbackTotal = new Counter({
  name: "firecrawl_fire_pdf_async_fallback_total",
  help: "Fire-pdf async path fell back to sync /ocr",
  labelNames: ["reason"],
});

export const firePdfAsyncTotalDurationSeconds = new Histogram({
  name: "firecrawl_fire_pdf_async_total_duration_seconds",
  help: "Seconds from 'decide to use async' to 'result available'",
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1200, 1800],
});

export const firePdfAsyncPollCount = new Histogram({
  name: "firecrawl_fire_pdf_async_poll_count",
  help: "Number of GET /jobs/<id> polls per async job",
  buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500],
});

// Lane assignment mirrors fire-pdf's server-side classification. Used as
// the `lane` label on the submitted counter so we can see traffic mix
// before fire-pdf reports it on its own metrics.
export function laneForPages(pages: number | undefined): string {
  if (pages === undefined) return "unknown";
  if (pages <= 10) return "fast";
  if (pages <= 100) return "standard";
  if (pages <= 250) return "heavy";
  return "xl";
}
