import { config } from "../../../config";
import {
  FeedbackJobRow,
  FeedbackRating,
  RefundPolicySnapshot,
} from "./internal-types";

function hasJsonFormat(options: unknown): boolean {
  const formats = (options as { formats?: unknown })?.formats;
  if (!Array.isArray(formats)) return false;
  return formats.some(format => {
    if (format === "json") return true;
    return (
      !!format &&
      typeof format === "object" &&
      (format as { type?: unknown }).type === "json"
    );
  });
}

function hasScreenshotFormat(options: unknown): boolean {
  const formats = (options as { formats?: unknown })?.formats;
  if (!Array.isArray(formats)) return false;
  return formats.some(format => {
    if (format === "screenshot") return true;
    return (
      !!format &&
      typeof format === "object" &&
      (format as { type?: unknown }).type === "screenshot"
    );
  });
}

function hasPdfParser(options: unknown): boolean {
  const parsers = (options as { parsers?: unknown })?.parsers;
  return Array.isArray(parsers) && parsers.includes("pdf");
}

function hasActions(options: unknown): boolean {
  const actions = (options as { actions?: unknown })?.actions;
  return Array.isArray(actions) && actions.length > 0;
}

export function computeRefundPolicy(
  job: FeedbackJobRow,
  rating: FeedbackRating,
): { desiredRefund: number; policy: RefundPolicySnapshot } {
  const billedCredits = Math.max(0, job.credits_cost ?? 0);

  const none = (
    matchedReason: string,
    refundableRatings: FeedbackRating[] = [],
  ) => ({
    desiredRefund: 0,
    policy: {
      version: "feedback_refund_v1" as const,
      enabled: config.FEEDBACK_REFUND_ENABLED,
      endpoint: job.endpoint,
      mode: "none" as const,
      refundableRatings,
      matchedReason,
    },
  });

  if (!config.FEEDBACK_REFUND_ENABLED) {
    return none("refunds_disabled");
  }

  if (billedCredits <= 0) {
    return none("zero_billed_credits");
  }

  const flat = (
    flatCredits: number,
    matchedReason: string,
    refundableRatings: FeedbackRating[],
  ) => {
    if (!refundableRatings.includes(rating)) {
      return none("rating_not_refundable", refundableRatings);
    }
    return {
      desiredRefund: Math.min(flatCredits, billedCredits),
      policy: {
        version: "feedback_refund_v1" as const,
        enabled: true,
        endpoint: job.endpoint,
        mode: "flat" as const,
        refundableRatings,
        matchedReason,
        flatCredits,
        maxCredits: flatCredits,
      },
    };
  };

  const percentage = (
    percent: number,
    maxCredits: number,
    matchedReason: string,
    refundableRatings: FeedbackRating[],
  ) => {
    if (!refundableRatings.includes(rating)) {
      return none("rating_not_refundable", refundableRatings);
    }
    const calculated = Math.ceil(billedCredits * percent);
    return {
      desiredRefund: Math.min(calculated, maxCredits, billedCredits),
      policy: {
        version: "feedback_refund_v1" as const,
        enabled: true,
        endpoint: job.endpoint,
        mode: "percentage_with_cap" as const,
        refundableRatings,
        matchedReason,
        percent,
        maxCredits,
      },
    };
  };

  switch (job.endpoint) {
    case "search":
      return flat(1, "search_feedback", ["good", "partial", "bad"]);
    case "map":
      return flat(1, "map_feedback", ["partial", "bad"]);
    case "parse":
      return percentage(0.25, 10, "parse_feedback", ["partial", "bad"]);
    case "scrape":
      if (hasPdfParser(job.options)) {
        return percentage(0.25, 10, "scrape_pdf_feedback", ["partial", "bad"]);
      }
      if (hasJsonFormat(job.options)) {
        return percentage(0.25, 5, "scrape_json_feedback", ["partial", "bad"]);
      }
      if (hasActions(job.options) || hasScreenshotFormat(job.options)) {
        return percentage(0.25, 5, "scrape_addon_feedback", ["partial", "bad"]);
      }
      return flat(1, "scrape_feedback", ["partial", "bad"]);
  }
}
