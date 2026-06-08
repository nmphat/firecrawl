export type GetOrCreateCustomerParams = {
  customerId: string;
  name?: string | null;
  email?: string | null;
  autoEnablePlanId?: string;
};

export type GetEntityParams = {
  customerId: string;
  entityId: string;
};

export type CreateEntityParams = {
  customerId: string;
  entityId: string;
  featureId: string;
  name?: string | null;
};

export type TrackParams = {
  customerId: string;
  entityId?: string;
  featureId: string;
  value: number;
  properties?: Record<string, unknown>;
};

export type EnsureOrgProvisionedParams = {
  orgId: string;
  name?: string | null;
  email?: string | null;
};

export type EnsureTeamProvisionedParams = {
  teamId: string;
  orgId?: string | null;
  name?: string | null;
};

export type LockCreditsParams = {
  teamId: string;
  value: number;
  lockId?: string;
  expiresAt?: number;
  properties?: Record<string, unknown>;
};

/**
 * Outcome of a lockCredits call.
 *
 * - `locked`: a hold was placed; `lockId` must be finalized later.
 * - `denied`: Autumn explicitly answered `allowed: false` (out of quota). The
 *   caller should refuse the work — this is the only signal that gates usage.
 * - `unavailable`: Autumn is off, the team is preview, or the API errored. The
 *   caller should fall back to running without a lock (fail-open).
 */
export type LockCreditsResult =
  | { status: "locked"; lockId: string }
  | { status: "denied" }
  | { status: "unavailable" };

export type FinalizeCreditsLockParams = {
  lockId: string;
  action: "confirm" | "release";
  overrideValue?: number;
  properties?: Record<string, unknown>;
};

export type TrackCreditsParams = {
  teamId: string;
  value: number;
  properties?: Record<string, unknown>;
  requestScoped?: boolean;
};

export type CreateEntityResult =
  | { ok: true; entity: unknown }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false };
