import {
  isPostgrestNoRowsError,
  supabase_rr_service,
  supabase_service,
} from "../../../services/supabase";
import { POSTGRES_UNIQUE_VIOLATION } from "./constants";
import { FeedbackInput, FeedbackLogger } from "./internal-types";

type ExistingLegacySearchFeedback = {
  id: string;
  credits_refunded: number | null;
};

export async function findExistingLegacySearchFeedback(
  searchId: string,
  dbTeamId: string,
): Promise<ExistingLegacySearchFeedback | null> {
  const { data, error } = await supabase_rr_service
    .from("search_feedback")
    .select("id, credits_refunded")
    .eq("search_id", searchId)
    .eq("team_id", dbTeamId)
    .single();

  if (error) {
    if (isPostgrestNoRowsError(error)) return null;
    throw error;
  }

  return data as ExistingLegacySearchFeedback | null;
}

export async function mirrorSearchFeedback(
  feedbackId: string,
  jobId: string,
  dbTeamId: string,
  feedback: FeedbackInput,
  creditsRefunded: number,
  logger: FeedbackLogger,
) {
  const row = {
    id: feedbackId,
    search_id: jobId,
    team_id: dbTeamId,
    overall_rating: feedback.rating,
    valuable_sources: feedback.valuableSources ?? [],
    missing_content: feedback.missingContent ?? [],
    query_suggestions: feedback.querySuggestions ?? null,
    integration: feedback.integration ?? null,
    origin: feedback.origin ?? null,
    credits_refunded: creditsRefunded,
  };

  const { error } = await supabase_service.from("search_feedback").insert(row);
  if (!error) return;

  if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
    const { error: updateErr } = await supabase_service
      .from("search_feedback")
      .update({ credits_refunded: creditsRefunded })
      .eq("search_id", jobId)
      .eq("team_id", dbTeamId);

    if (updateErr) {
      logger.warn("Failed to update mirrored search_feedback row", {
        error: updateErr,
        feedbackId,
        jobId,
      });
    }
    return;
  }

  logger.warn("Failed to mirror endpoint feedback into search_feedback", {
    error,
    feedbackId,
    jobId,
  });
}
