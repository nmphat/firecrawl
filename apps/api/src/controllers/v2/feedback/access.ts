import { config } from "../../../config";
import { RequestWithAuth } from "../types";
import {
  FeedbackLogger,
  FeedbackRecordOptions,
  FeedbackRecordResult,
} from "./internal-types";
import { fail } from "./responses";
import { isPreviewTeam } from "./team";

export function validateFeedbackAccess(
  req: RequestWithAuth<any, any, any>,
  options: FeedbackRecordOptions,
  logger: FeedbackLogger,
): FeedbackRecordResult | null {
  if (config.USE_DB_AUTHENTICATION !== true) {
    return fail(
      503,
      "DB_DISABLED",
      options.dbDisabledMessage ??
        "Feedback requires database authentication and is unavailable on this deployment.",
    );
  }

  if (isPreviewTeam(req.auth.team_id)) {
    return fail(
      403,
      "PREVIEW_TEAM_NOT_ALLOWED",
      "Feedback is not available for preview teams.",
    );
  }

  if (req.acuc?.flags?.searchFeedbackOptOut === true) {
    logger.info("Rejected feedback: team opted out");
    return fail(
      403,
      "TEAM_OPTED_OUT",
      "Feedback is disabled for this team. Contact support@firecrawl.com to re-enable.",
    );
  }

  return null;
}
