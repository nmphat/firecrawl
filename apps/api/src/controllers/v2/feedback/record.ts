import { v7 as uuidv7 } from "uuid";
import { logger as _logger } from "../../../lib/logger";
import { captureExceptionWithZdrCheck } from "../../../services/sentry";
import { RequestWithAuth } from "../types";
import { validateFeedbackAccess } from "./access";
import { POSTGRES_UNIQUE_VIOLATION } from "./constants";
import { dailyCapFor } from "./daily-cap";
import {
  endpointInsertConflictResponse,
  existingLegacySearchResponse,
} from "./duplicates";
import {
  insertEndpointFeedback,
  updateEndpointFeedbackRefundDetails,
} from "./endpoint-feedback-store";
import { FeedbackRecordOptions, FeedbackRecordResult } from "./internal-types";
import { lookupJobWithRetry, validateJobForFeedback } from "./job-validation";
import { mirrorSearchFeedback } from "./legacy-search-feedback";
import { refundFeedbackCredits } from "./refund";
import { computeRefundPolicy } from "./refund-policy";
import { sumEndpointCreditsRefundedToday } from "./refund-totals";
import { fail } from "./responses";
import { normalizeTeamId } from "./team";

export async function recordEndpointFeedback(
  req: RequestWithAuth<any, any, any>,
  options: FeedbackRecordOptions,
): Promise<FeedbackRecordResult> {
  const logger = _logger.child({
    module: "api/v2",
    method: "recordEndpointFeedback",
    endpoint: options.endpoint,
    jobId: options.jobId,
    teamId: req.auth.team_id,
  });

  const accessFailure = validateFeedbackAccess(req, options, logger);
  if (accessFailure) return accessFailure;

  const dbTeamId = normalizeTeamId(req.auth.team_id);

  try {
    const jobOrFailure = await lookupJobWithRetry(options, dbTeamId, logger);
    if ("status" in jobOrFailure) return jobOrFailure;

    const jobValidationFailure = validateJobForFeedback(
      jobOrFailure,
      options,
      logger,
    );
    if (jobValidationFailure) return jobValidationFailure;

    const legacySearchDuplicate = await existingLegacySearchResponse(
      options,
      dbTeamId,
      logger,
    );
    if (legacySearchDuplicate) return legacySearchDuplicate;

    const feedbackId = uuidv7();
    const insertErr = await insertEndpointFeedback({
      feedbackId,
      options,
      job: jobOrFailure,
      dbTeamId,
      apiKeyId: req.acuc?.api_key_id ?? null,
    });

    if (insertErr) {
      if (insertErr.code === POSTGRES_UNIQUE_VIOLATION) {
        return await endpointInsertConflictResponse(options, dbTeamId, logger);
      }

      logger.error("Failed to insert endpoint feedback", { error: insertErr });
      return fail(500, "INTERNAL", "Failed to record feedback.");
    }

    const dailyCap = dailyCapFor(options);
    const refundedTodayBefore = await sumEndpointCreditsRefundedToday(
      dbTeamId,
      options.endpoint,
      logger,
    );
    const remainingDailyCap = Math.max(0, dailyCap - refundedTodayBefore);

    const { desiredRefund, policy } = computeRefundPolicy(
      jobOrFailure,
      options.feedback.rating,
    );
    const cappedRefund = Math.min(desiredRefund, remainingDailyCap);

    let dailyCapReached = false;
    if (desiredRefund > 0 && cappedRefund === 0) {
      dailyCapReached = true;
      logger.info(
        "Daily refund cap reached for team; feedback recorded with zero refund",
        { dailyCap, refundedTodayBefore },
      );
    }

    const creditsRefunded = await refundFeedbackCredits({
      req,
      options,
      feedbackId,
      cappedRefund,
      policy,
      logger,
    });

    const updateErr = await updateEndpointFeedbackRefundDetails(
      feedbackId,
      creditsRefunded,
      policy,
    );
    if (updateErr) {
      logger.warn("Failed to persist endpoint feedback refund details", {
        error: updateErr,
        feedbackId,
        creditsRefunded,
      });
    }

    if (options.endpoint === "search") {
      await mirrorSearchFeedback(
        feedbackId,
        options.jobId,
        dbTeamId,
        options.feedback,
        creditsRefunded,
        logger,
      );
    }

    const creditsRefundedToday = refundedTodayBefore + creditsRefunded;
    if (!dailyCapReached && creditsRefundedToday >= dailyCap && dailyCap > 0) {
      dailyCapReached = true;
    }

    logger.info("Endpoint feedback recorded", {
      feedbackId,
      endpoint: options.endpoint,
      creditsRefunded,
      creditsBilled: jobOrFailure.credits_cost ?? 0,
      rating: options.feedback.rating,
      issueTypes: options.feedback.issues ?? [],
      refundPolicy: policy.matchedReason,
      creditsRefundedToday,
      dailyRefundCap: dailyCap,
      dailyCapReached,
    });

    return {
      status: 200,
      body: {
        success: true,
        feedbackId,
        creditsRefunded,
        creditsRefundedToday,
        dailyRefundCap: dailyCap,
        ...(dailyCapReached
          ? {
              dailyCapReached: true,
              warning: `Daily refund cap of ${dailyCap} credits reached for this team (UTC day). Feedback was recorded; further /feedback calls today will not refund credits.`,
            }
          : {}),
      },
    };
  } catch (error) {
    captureExceptionWithZdrCheck(error);
    logger.error("Unhandled error while recording endpoint feedback", {
      error,
    });
    return fail(
      500,
      "INTERNAL",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}
