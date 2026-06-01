import { EndpointFeedbackErrorCode, SearchFeedbackErrorCode } from "../types";
import { FeedbackRecordResult } from "./internal-types";

export function fail(
  status: number,
  code: EndpointFeedbackErrorCode | SearchFeedbackErrorCode,
  error: string,
): FeedbackRecordResult {
  return {
    status,
    body: {
      success: false,
      error,
      feedbackErrorCode: code,
    },
  };
}
