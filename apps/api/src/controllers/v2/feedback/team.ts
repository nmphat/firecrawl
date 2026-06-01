import { PREVIEW_TEAM_ID } from "./constants";

export function isPreviewTeam(teamId: string): boolean {
  return teamId === "preview" || teamId.startsWith("preview_");
}

export function normalizeTeamId(teamId: string): string {
  return isPreviewTeam(teamId) ? PREVIEW_TEAM_ID : teamId;
}
