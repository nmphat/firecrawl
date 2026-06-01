import {
  supabase_rr_service,
  supabase_service,
} from "../../../services/supabase";
import { EndpointFeedbackEndpoint } from "../types";
import {
  FeedbackJobRow,
  FeedbackRecordOptions,
  RefundPolicySnapshot,
} from "./internal-types";

type DbError = { code?: string } & Record<string, unknown>;

type ExistingEndpointFeedback = {
  id: string;
  credits_refunded: number | null;
};

function feedbackMetadata(
  options: FeedbackRecordOptions,
): Record<string, unknown> {
  return {
    ...(options.feedback.metadata ?? {}),
    ...(options.feedback.url ? { url: options.feedback.url } : {}),
    ...(options.feedback.pageNumbers
      ? { pageNumbers: options.feedback.pageNumbers }
      : {}),
  };
}

export async function insertEndpointFeedback(params: {
  feedbackId: string;
  options: FeedbackRecordOptions;
  job: FeedbackJobRow;
  dbTeamId: string;
  apiKeyId?: number | null;
}): Promise<DbError | null> {
  const { feedbackId, options, job, dbTeamId, apiKeyId } = params;
  const { error } = await supabase_service.from("endpoint_feedback").insert({
    id: feedbackId,
    endpoint: options.endpoint,
    job_id: options.jobId,
    request_id: job.request_id,
    api_version: "v2",
    team_id: dbTeamId,
    api_key_id: apiKeyId ?? null,
    rating: options.feedback.rating,
    issue_types: options.feedback.issues ?? [],
    tags: options.feedback.tags ?? [],
    comment: options.feedback.note ?? null,
    valuable_sources: options.feedback.valuableSources ?? [],
    missing_content: options.feedback.missingContent ?? [],
    query_suggestions: options.feedback.querySuggestions ?? null,
    expected: options.feedback.expected ?? null,
    actual: options.feedback.actual ?? null,
    metadata: feedbackMetadata(options),
    job_status: job.is_successful === false ? "failed" : "completed",
    credits_billed: job.credits_cost ?? 0,
    credits_refunded: 0,
    refund_policy: null,
    integration: options.feedback.integration ?? null,
    origin: options.feedback.origin ?? null,
  });

  return error as DbError | null;
}

export async function findExistingEndpointFeedback(
  dbTeamId: string,
  endpoint: EndpointFeedbackEndpoint,
  jobId: string,
): Promise<ExistingEndpointFeedback | null> {
  const { data } = await supabase_rr_service
    .from("endpoint_feedback")
    .select("id, credits_refunded")
    .eq("team_id", dbTeamId)
    .eq("endpoint", endpoint)
    .eq("job_id", jobId)
    .single();

  return data as ExistingEndpointFeedback | null;
}

export async function updateEndpointFeedbackRefundDetails(
  feedbackId: string,
  creditsRefunded: number,
  policy: RefundPolicySnapshot,
): Promise<DbError | null> {
  const { error } = await supabase_service
    .from("endpoint_feedback")
    .update({
      credits_refunded: creditsRefunded,
      refund_policy: policy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", feedbackId);

  return error as DbError | null;
}
