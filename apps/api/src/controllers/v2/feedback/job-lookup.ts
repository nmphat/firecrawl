import {
  isPostgrestNoRowsError,
  supabase_rr_service,
} from "../../../services/supabase";
import { EndpointFeedbackEndpoint } from "../types";
import { FeedbackJobRow } from "./internal-types";

function tableForEndpoint(endpoint: EndpointFeedbackEndpoint): string {
  switch (endpoint) {
    case "search":
      return "searches";
    case "scrape":
      return "scrapes";
    case "parse":
      return "parses";
    case "map":
      return "maps";
  }
}

function selectForEndpoint(endpoint: EndpointFeedbackEndpoint): string {
  switch (endpoint) {
    case "map":
      return "id, request_id, team_id, credits_cost, created_at, options";
    default:
      return "id, request_id, team_id, credits_cost, created_at, is_successful, options";
  }
}

export async function lookupJobRow(
  endpoint: EndpointFeedbackEndpoint,
  jobId: string,
  dbTeamId: string,
): Promise<FeedbackJobRow | null> {
  const { data, error } = await supabase_rr_service
    .from(tableForEndpoint(endpoint))
    .select(selectForEndpoint(endpoint))
    .eq("id", jobId)
    .eq("team_id", dbTeamId)
    .single();

  if (error) {
    if (isPostgrestNoRowsError(error)) return null;
    throw error;
  }

  if (!data) return null;

  const row = data as any;
  return {
    endpoint,
    id: row.id,
    request_id: row.request_id ?? null,
    team_id: row.team_id,
    credits_cost: row.credits_cost ?? 0,
    created_at: row.created_at,
    is_successful: endpoint === "map" ? true : (row.is_successful ?? null),
    options: row.options ?? null,
  };
}
