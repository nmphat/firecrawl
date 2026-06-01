import { config } from "../../../config";
import { FEEDBACK_LOOKUP_RACE_RETRY_MS } from "./constants";
import {
  FeedbackJobRow,
  FeedbackLogger,
  FeedbackRecordOptions,
  FeedbackRecordResult,
} from "./internal-types";
import { lookupJobRow } from "./job-lookup";
import { fail } from "./responses";

export async function lookupJobWithRetry(
  options: FeedbackRecordOptions,
  dbTeamId: string,
  logger: FeedbackLogger,
): Promise<FeedbackJobRow | FeedbackRecordResult> {
  try {
    let job = await lookupJobRow(options.endpoint, options.jobId, dbTeamId);
    if (!job) {
      await new Promise(resolve =>
        setTimeout(resolve, FEEDBACK_LOOKUP_RACE_RETRY_MS),
      );
      job = await lookupJobRow(options.endpoint, options.jobId, dbTeamId);
    }

    if (!job) {
      return fail(
        404,
        options.notFoundCode ?? "JOB_NOT_FOUND",
        `${options.endpoint} job not found for this team.`,
      );
    }

    return job;
  } catch (lookupErr) {
    logger.error("Failed to look up job for feedback", { error: lookupErr });
    return fail(500, "INTERNAL", "Failed to look up job.");
  }
}

export function validateJobForFeedback(
  job: FeedbackJobRow,
  options: FeedbackRecordOptions,
  logger: FeedbackLogger,
): FeedbackRecordResult | null {
  if (options.requireSuccessfulJob && job.is_successful === false) {
    return fail(
      409,
      options.failedJobCode ?? "INTERNAL",
      `Cannot submit feedback for a ${options.endpoint} job that did not succeed.`,
    );
  }

  const maxAgeSec = options.maxAgeSec ?? config.FEEDBACK_MAX_AGE_SEC;
  const maxAgeMs = maxAgeSec * 1000;
  const createdAtMs = new Date(job.created_at).getTime();
  if (Number.isNaN(createdAtMs)) {
    logger.warn("Job row had unparseable created_at", {
      created_at: job.created_at,
    });
    return null;
  }

  if (Date.now() - createdAtMs <= maxAgeMs) return null;

  return fail(
    409,
    "FEEDBACK_WINDOW_EXPIRED",
    options.windowExpiredMessage ??
      `Feedback must be submitted within ${maxAgeSec} seconds of the job.`,
  );
}
