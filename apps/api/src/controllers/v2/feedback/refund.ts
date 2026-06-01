import { RequestWithAuth } from "../types";
import { autumnService } from "../../../services/autumn/autumn.service";
import {
  FeedbackLogger,
  FeedbackRecordOptions,
  RefundPolicySnapshot,
} from "./internal-types";

export async function refundFeedbackCredits(params: {
  req: RequestWithAuth<any, any, any>;
  options: FeedbackRecordOptions;
  feedbackId: string;
  cappedRefund: number;
  policy: RefundPolicySnapshot;
  logger: FeedbackLogger;
}): Promise<number> {
  const { req, options, feedbackId, cappedRefund, policy, logger } = params;
  if (cappedRefund <= 0) return 0;

  try {
    await autumnService.refundCredits({
      teamId: req.auth.team_id,
      value: cappedRefund,
      properties: {
        source: options.source,
        endpoint: options.endpoint,
        jobId: options.jobId,
        feedbackId,
        rating: options.feedback.rating,
        refundPolicy: policy.matchedReason,
      },
    });
    return cappedRefund;
  } catch (error) {
    logger.error("Feedback refund failed; feedback retained", { error });
    return 0;
  }
}
