import { config } from "../../../config";
import { FeedbackRecordOptions } from "./internal-types";

export function dailyCapFor(options: FeedbackRecordOptions): number {
  return options.dailyCapCredits ?? config.FEEDBACK_DAILY_CAP_CREDITS;
}
