import { Meta } from "../..";
import { config } from "../../../../config";
import { z } from "zod";
import { fetch } from "undici";
import type { PDFProcessorResult } from "./types";
import type { PDFMode } from "../../../../controllers/v2/types";
import { safeMarkdownToHtml } from "./markdownToHtml";
import { createPdfCacheKey } from "../../../../lib/gcs-pdf-cache";
import { storage } from "../../../../lib/gcs-jobs";
import {
  firePdfAsyncSubmittedTotal,
  firePdfAsyncCompletedTotal,
  firePdfAsyncFallbackTotal,
  firePdfAsyncTotalDurationSeconds,
  firePdfAsyncPollCount,
  laneForPages,
} from "../../../../lib/fire-pdf-metrics";
import { scrapePDFWithFirePDF } from "./firePDF";
import { AbortManagerThrownError } from "../../lib/abortManager";

// Per /jobs validation: 5s < (deadline_at - now) < 30min.
const MIN_DEADLINE_MS = 5_000;
const MAX_DEADLINE_MS = 30 * 60 * 1000;
const DEFAULT_DEADLINE_MS = 5 * 60 * 1000;

// Polling cadence: floor from retry_after_ms, default 1s, cap 5s,
// exponential growth up to the cap.
const POLL_DEFAULT_MS = 1_000;
const POLL_MAX_MS = 5_000;

// After deadline_at passes the worker is supposed to write `expired`;
// give it 30s of grace before we abandon the async path ourselves.
const POLL_BUFFER_AFTER_DEADLINE_MS = 30_000;

type FallbackReason =
  | "http_404"
  | "http_503"
  | "http_429"
  | "http_5xx"
  | "http_4xx"
  | "network_error"
  | "terminal_failed"
  | "terminal_expired"
  | "terminal_cancelled"
  | "polling_timeout"
  | "gcs_upload_failed"
  | "gcs_download_failed";

class AsyncFallback extends Error {
  reason: FallbackReason;
  constructor(reason: FallbackReason) {
    super(`fire-pdf async fallback: ${reason}`);
    this.reason = reason;
  }
}

function parseGcsUri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice("gs://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

const submitResponseSchema = z.object({
  scrape_id: z.string().optional(),
  status: z.enum(["queued", "published", "done"]).optional(),
  retry_after_ms: z.number().optional(),
});

const pollResponseSchema = z.object({
  scrape_id: z.string().optional(),
  status: z.enum([
    "queued",
    "published",
    "running",
    "done",
    "failed",
    "expired",
    "cancelled",
  ]),
  result_gcs_uri: z.string().optional(),
  pages_processed: z.number().optional(),
  failed_pages: z.array(z.number()).nullable().optional(),
  partial_pages: z.array(z.number()).nullable().optional(),
});

const resultJsonSchema = z.object({
  markdown: z.string(),
  failed_pages: z.array(z.number()).nullable().optional(),
  pages_processed: z.number().optional(),
});

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal.aborted) {
    throw (signal.reason as Error) ?? new Error("aborted");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject((signal.reason as Error) ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runAsync(
  meta: Meta,
  base64Content: string,
  maxPages: number | undefined,
  pagesProcessed: number | undefined,
  mode: PDFMode | undefined,
): Promise<PDFProcessorResult> {
  const logger = meta.logger;
  const scrapeId = meta.id;
  const signal = meta.abort.asSignal();

  const inputBucket = config.GCS_FIRE_PDF_BUCKET_NAME;
  const inputKey = `inputs/${scrapeId}.pdf`;
  const inputUri = `gs://${inputBucket}/${inputKey}`;

  const pdfBuffer = Buffer.from(base64Content, "base64");
  const pdfSha256 = createPdfCacheKey(pdfBuffer);

  // 1) Upload PDF to the input bucket. Fire-pdf workers read from here.
  try {
    const bucket = storage.bucket(inputBucket);
    await bucket.file(inputKey).save(pdfBuffer, {
      contentType: "application/pdf",
      metadata: {
        source: "firecrawl_fire_pdf_async",
        scrape_id: scrapeId,
        sha256: pdfSha256,
      },
    });
  } catch (error) {
    logger.warn("Fire-pdf async: GCS upload failed", { error, scrapeId });
    throw new AsyncFallback("gcs_upload_failed");
  }

  meta.abort.throwIfAborted();

  // 2) Compute deadline_at — fire-pdf requires 5s < delta < 30min.
  const remainingMs = meta.abort.scrapeTimeout() ?? DEFAULT_DEADLINE_MS;
  const clamped = Math.min(
    MAX_DEADLINE_MS - 1000,
    Math.max(MIN_DEADLINE_MS + 1000, Math.floor(remainingMs)),
  );
  const submitTime = Date.now();
  const deadlineEpochMs = submitTime + clamped;
  const deadlineAt = new Date(deadlineEpochMs).toISOString();

  const lane = laneForPages(pagesProcessed);

  const submitBody: Record<string, unknown> = {
    scrape_id: scrapeId,
    input_gcs_uri: inputUri,
    input_sha256: pdfSha256,
    source: "firecrawl",
    zdr: false,
    deadline_at: deadlineAt,
    team_id: meta.internalOptions.teamId,
    ...(meta.internalOptions.crawlId && {
      crawl_id: meta.internalOptions.crawlId,
    }),
    options: {
      ...(pagesProcessed !== undefined &&
        pagesProcessed > 0 && { pages_estimate: pagesProcessed }),
      ...(maxPages !== undefined && { max_pages: maxPages }),
      ...(mode !== undefined && { mode }),
    },
  };

  logger.info("Fire-pdf async: submitting job", {
    scrapeId,
    inputUri,
    deadlineAt,
    lane,
    pagesEstimate: pagesProcessed,
    maxPages,
    mode,
  });

  // 3) POST /jobs
  let submitResp;
  try {
    submitResp = await fetch(`${config.FIRE_PDF_BASE_URL}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.FIRE_PDF_API_KEY
          ? { Authorization: `Bearer ${config.FIRE_PDF_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(submitBody),
      signal,
    });
  } catch (error) {
    meta.abort.throwIfAborted();
    if (error instanceof AbortManagerThrownError) throw error;
    logger.warn("Fire-pdf async: POST /jobs network error", {
      error,
      scrapeId,
    });
    throw new AsyncFallback("network_error");
  }

  const submitStatus = submitResp.status;
  if (submitStatus === 404) throw new AsyncFallback("http_404");
  if (submitStatus === 503) throw new AsyncFallback("http_503");
  if (submitStatus === 429) throw new AsyncFallback("http_429");
  if (submitStatus >= 500) throw new AsyncFallback("http_5xx");
  if (submitStatus !== 200 && submitStatus !== 202) {
    let body = "";
    try {
      body = (await submitResp.text()).slice(0, 500);
    } catch {
      // body read may fail after abort; ignore — we're already falling back
    }
    logger.warn("Fire-pdf async: POST /jobs returned unexpected status", {
      status: submitStatus,
      body,
      scrapeId,
    });
    throw new AsyncFallback("http_4xx");
  }

  let submitJson: z.infer<typeof submitResponseSchema>;
  try {
    submitJson = submitResponseSchema.parse(await submitResp.json());
  } catch (error) {
    logger.warn("Fire-pdf async: malformed POST /jobs response", {
      error,
      scrapeId,
    });
    throw new AsyncFallback("http_5xx");
  }

  firePdfAsyncSubmittedTotal.labels({ lane }).inc();

  // 4) Poll GET /jobs/<scrape_id> until terminal.
  let pollDelayMs = Math.max(
    POLL_DEFAULT_MS,
    Math.min(POLL_MAX_MS, submitJson.retry_after_ms ?? POLL_DEFAULT_MS),
  );
  let pollCount = 0;
  let terminal: z.infer<typeof pollResponseSchema> | null = null;

  while (terminal === null) {
    if (Date.now() > deadlineEpochMs + POLL_BUFFER_AFTER_DEADLINE_MS) {
      throw new AsyncFallback("polling_timeout");
    }

    await sleepWithAbort(pollDelayMs, signal);
    meta.abort.throwIfAborted();
    pollCount++;

    let pollResp;
    try {
      pollResp = await fetch(
        `${config.FIRE_PDF_BASE_URL}/jobs/${encodeURIComponent(scrapeId)}`,
        {
          method: "GET",
          headers: {
            ...(config.FIRE_PDF_API_KEY
              ? { Authorization: `Bearer ${config.FIRE_PDF_API_KEY}` }
              : {}),
          },
          signal,
        },
      );
    } catch (error) {
      meta.abort.throwIfAborted();
      if (error instanceof AbortManagerThrownError) throw error;
      logger.warn("Fire-pdf async: GET /jobs network error", {
        error,
        scrapeId,
        pollCount,
      });
      throw new AsyncFallback("network_error");
    }

    const pollStatus = pollResp.status;
    if (pollStatus === 404) throw new AsyncFallback("http_404");
    if (pollStatus >= 500) throw new AsyncFallback("http_5xx");
    if (pollStatus !== 200) throw new AsyncFallback("http_4xx");

    let pollJson: z.infer<typeof pollResponseSchema>;
    try {
      pollJson = pollResponseSchema.parse(await pollResp.json());
    } catch (error) {
      logger.warn("Fire-pdf async: malformed GET /jobs response", {
        error,
        scrapeId,
      });
      throw new AsyncFallback("http_5xx");
    }

    switch (pollJson.status) {
      case "done":
        terminal = pollJson;
        firePdfAsyncCompletedTotal.labels({ terminal_status: "done" }).inc();
        break;
      case "failed":
        firePdfAsyncCompletedTotal.labels({ terminal_status: "failed" }).inc();
        throw new AsyncFallback("terminal_failed");
      case "expired":
        firePdfAsyncCompletedTotal.labels({ terminal_status: "expired" }).inc();
        throw new AsyncFallback("terminal_expired");
      case "cancelled":
        firePdfAsyncCompletedTotal
          .labels({ terminal_status: "cancelled" })
          .inc();
        throw new AsyncFallback("terminal_cancelled");
      default:
        // queued / published / running — exponential backoff, capped.
        pollDelayMs = Math.min(POLL_MAX_MS, Math.ceil(pollDelayMs * 1.5));
        break;
    }
  }

  firePdfAsyncPollCount.observe(pollCount);

  // 5) Download the result JSON from GCS.
  if (!terminal.result_gcs_uri) {
    logger.warn("Fire-pdf async: terminal 'done' without result_gcs_uri", {
      scrapeId,
    });
    throw new AsyncFallback("gcs_download_failed");
  }
  const parsed = parseGcsUri(terminal.result_gcs_uri);
  if (!parsed) {
    logger.warn("Fire-pdf async: malformed result_gcs_uri", {
      scrapeId,
      uri: terminal.result_gcs_uri,
    });
    throw new AsyncFallback("gcs_download_failed");
  }

  let resultJson: z.infer<typeof resultJsonSchema>;
  try {
    const [content] = await storage
      .bucket(parsed.bucket)
      .file(parsed.key)
      .download();
    resultJson = resultJsonSchema.parse(JSON.parse(content.toString()));
  } catch (error) {
    logger.warn("Fire-pdf async: GCS result download/parse failed", {
      error,
      scrapeId,
    });
    throw new AsyncFallback("gcs_download_failed");
  }

  const pages =
    resultJson.pages_processed ?? terminal.pages_processed ?? pagesProcessed;

  logger.info("Fire-pdf async: completed", {
    scrapeId,
    pollCount,
    pagesProcessed: pages,
    markdownLength: resultJson.markdown.length,
    failedPages: resultJson.failed_pages,
  });

  return {
    markdown: resultJson.markdown,
    html: await safeMarkdownToHtml(resultJson.markdown, logger, scrapeId),
    pagesProcessed: pages,
  };
}

/**
 * Async fire-pdf client (POST /jobs + poll + GCS result). Behavior contract:
 *
 *   - On success, returns a result indistinguishable from `scrapePDFWithFirePDF`.
 *   - On any fallback condition (admission decline, terminal failure,
 *     polling timeout, GCS error), silently falls back to the sync /ocr
 *     path so the user never sees a failure they would not have seen
 *     before. The reason is recorded on the fallback counter.
 *   - Abort propagates as `AbortManagerThrownError` — we do NOT fall back
 *     when the scrape-tier budget has been exhausted.
 */
export async function scrapePDFWithFirePDFAsync(
  meta: Meta,
  base64Content: string,
  maxPages: number | undefined,
  pagesProcessed: number | undefined,
  mode: PDFMode | undefined,
): Promise<PDFProcessorResult> {
  const startedAt = Date.now();
  try {
    const result = await runAsync(
      meta,
      base64Content,
      maxPages,
      pagesProcessed,
      mode,
    );
    firePdfAsyncTotalDurationSeconds.observe((Date.now() - startedAt) / 1000);
    return result;
  } catch (error) {
    if (error instanceof AsyncFallback) {
      firePdfAsyncFallbackTotal.labels({ reason: error.reason }).inc();
      meta.logger.info("Fire-pdf async falling back to sync /ocr", {
        scrapeId: meta.id,
        reason: error.reason,
        elapsedMs: Date.now() - startedAt,
      });
      const syncResult = await scrapePDFWithFirePDF(
        meta,
        base64Content,
        maxPages,
        pagesProcessed,
        mode,
      );
      firePdfAsyncTotalDurationSeconds.observe((Date.now() - startedAt) / 1000);
      return syncResult;
    }
    throw error;
  }
}
