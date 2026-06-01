import { findExistingEndpointFeedback } from "./endpoint-feedback-store";
import {
  FeedbackLogger,
  FeedbackRecordOptions,
  FeedbackRecordResult,
} from "./internal-types";
import { findExistingLegacySearchFeedback } from "./legacy-search-feedback";
import { dailyCapFor } from "./daily-cap";
import { sumEndpointCreditsRefundedToday } from "./refund-totals";

function alreadySubmittedResponse(params: {
  feedbackId: string;
  warning: string;
  creditsRefundedToday: number;
  dailyCap: number;
}): FeedbackRecordResult {
  return {
    status: 200,
    body: {
      success: true,
      feedbackId: params.feedbackId,
      creditsRefunded: 0,
      alreadySubmitted: true,
      creditsRefundedToday: params.creditsRefundedToday,
      dailyRefundCap: params.dailyCap,
      warning: params.warning,
    },
  };
}

export async function existingLegacySearchResponse(
  options: FeedbackRecordOptions,
  dbTeamId: string,
  logger: FeedbackLogger,
): Promise<FeedbackRecordResult | null> {
  if (options.endpoint !== "search") return null;

  const existingLegacy = await findExistingLegacySearchFeedback(
    options.jobId,
    dbTeamId,
  );
  if (!existingLegacy) return null;

  return alreadySubmittedResponse({
    feedbackId: existingLegacy.id,
    creditsRefundedToday: await sumEndpointCreditsRefundedToday(
      dbTeamId,
      options.endpoint,
      logger,
    ),
    dailyCap: dailyCapFor(options),
    warning:
      "Feedback was already submitted for this search; no additional refund issued.",
  });
}

export async function endpointInsertConflictResponse(
  options: FeedbackRecordOptions,
  dbTeamId: string,
  logger: FeedbackLogger,
): Promise<FeedbackRecordResult> {
  const existing = await findExistingEndpointFeedback(
    dbTeamId,
    options.endpoint,
    options.jobId,
  );

  return alreadySubmittedResponse({
    feedbackId: existing?.id ?? "",
    creditsRefundedToday: await sumEndpointCreditsRefundedToday(
      dbTeamId,
      options.endpoint,
      logger,
    ),
    dailyCap: dailyCapFor(options),
    warning:
      "Feedback was already submitted for this job; no additional refund issued.",
  });
}
