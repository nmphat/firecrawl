jest.mock("uuid", () => ({
  v7: () => "test-uuid-v7",
}));

// processMonitorCheckJob touches the store, billing queue, scrape queue, and
// Autumn. Mock those boundaries so we can exercise the credit-gating branch in
// isolation without real I/O.
jest.mock("./store", () => ({
  getMonitorForUpdate: jest.fn(),
  getMonitorCheck: jest.fn(),
  markMonitorRunning: jest.fn(),
  updateMonitorCheck: jest.fn(),
  updateMonitorScheduleAfterRun: jest.fn(),
}));
jest.mock("../autumn/autumn.service", () => ({
  autumnService: {
    lockCredits: jest.fn(),
    finalizeCreditsLock: jest.fn(),
  },
}));
jest.mock("../queue-jobs", () => ({
  addScrapeJob: jest.fn(),
  _addScrapeJobToBullMQ: jest.fn(),
}));
jest.mock("../queue-service", () => ({
  getBillingQueue: jest.fn(() => ({ add: jest.fn() })),
}));
jest.mock("./interest", () => ({
  trackMonitorCheckStartedInterest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../logging/log_job", () => ({
  logRequest: jest.fn().mockResolvedValue(undefined),
}));

import {
  isMonitorCheckStale,
  MONITOR_CHECK_STALE_TIMEOUT_MS,
  processMonitorCheckJob,
} from "./runner";
import * as store from "./store";
import { autumnService } from "../autumn/autumn.service";
import { addScrapeJob } from "../queue-jobs";
import { getBillingQueue } from "../queue-service";

describe("monitoring runner", () => {
  describe("isMonitorCheckStale", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");

    it("returns true when a running check is at least 1 hour old", () => {
      expect(
        isMonitorCheckStale(
          {
            started_at: new Date(
              now.getTime() - MONITOR_CHECK_STALE_TIMEOUT_MS,
            ).toISOString(),
            updated_at: now.toISOString(),
            created_at: now.toISOString(),
          },
          now,
        ),
      ).toBe(true);
    });

    it("returns false when a running check is not yet stale", () => {
      expect(
        isMonitorCheckStale(
          {
            started_at: new Date(
              now.getTime() - MONITOR_CHECK_STALE_TIMEOUT_MS + 1,
            ).toISOString(),
            updated_at: now.toISOString(),
            created_at: now.toISOString(),
          },
          now,
        ),
      ).toBe(false);
    });

    it("falls back to updated_at for malformed started_at values", () => {
      expect(
        isMonitorCheckStale(
          {
            started_at: null,
            updated_at: new Date(
              now.getTime() - MONITOR_CHECK_STALE_TIMEOUT_MS,
            ).toISOString(),
            created_at: now.toISOString(),
          },
          now,
        ),
      ).toBe(true);
    });
  });

  describe("processMonitorCheckJob credit gating", () => {
    const monitor = {
      id: "mon-1",
      team_id: "team-1",
      status: "active",
      schedule_cron: "*/30 * * * *",
      schedule_timezone: "UTC",
      next_run_at: null,
      webhook: null,
      notification: { email: { enabled: false } },
      targets: [
        {
          id: "t1",
          type: "scrape",
          urls: ["https://example.com"],
          scrapeOptions: { formats: ["markdown"] },
        },
      ],
    } as any;

    const job = { teamId: "team-1", monitorId: "mon-1", checkId: "chk-1" };

    const updateMonitorCheck = store.updateMonitorCheck as jest.Mock;
    const lockCredits = autumnService.lockCredits as jest.Mock;
    const addScrapeJobMock = addScrapeJob as jest.Mock;
    const getBillingQueueMock = getBillingQueue as jest.Mock;

    const skipQuotaPatch = () =>
      updateMonitorCheck.mock.calls.find(
        call => call[1]?.status === "skipped_quota",
      );

    beforeEach(() => {
      jest.clearAllMocks();
      (store.getMonitorForUpdate as jest.Mock).mockResolvedValue(monitor);
      (store.getMonitorCheck as jest.Mock).mockResolvedValue({
        id: "chk-1",
        status: "queued",
        estimated_credits: 5,
      });
      (store.markMonitorRunning as jest.Mock).mockResolvedValue(undefined);
      (store.updateMonitorScheduleAfterRun as jest.Mock).mockResolvedValue(
        undefined,
      );
      updateMonitorCheck.mockImplementation((_id: string, patch: any) =>
        Promise.resolve({ id: "chk-1", estimated_credits: 5, ...patch }),
      );
      addScrapeJobMock.mockResolvedValue(undefined);
    });

    it("skips the check without scraping or billing when Autumn denies credits", async () => {
      lockCredits.mockResolvedValue({ status: "denied" });

      await processMonitorCheckJob(job as any);

      const patch = skipQuotaPatch();
      expect(patch).toBeTruthy();
      expect(patch![1]).toMatchObject({
        status: "skipped_quota",
        billing_status: "not_applicable",
        reserved_credits: null,
        actual_credits: 0,
      });

      // The schedule advances (so the next interval retries) but nothing runs.
      expect(store.updateMonitorScheduleAfterRun).toHaveBeenCalledTimes(1);
      expect(addScrapeJobMock).not.toHaveBeenCalled();
      expect(getBillingQueueMock).not.toHaveBeenCalled();
    });

    it("falls open and enqueues the scrape when Autumn is unavailable", async () => {
      lockCredits.mockResolvedValue({ status: "unavailable" });

      await processMonitorCheckJob(job as any);

      // No quota skip; the check proceeds to enqueue work, billing_status
      // falls back to not_applicable (lockless), and the reconciler finalizes
      // it later.
      expect(skipQuotaPatch()).toBeUndefined();
      expect(addScrapeJobMock).toHaveBeenCalledTimes(1);
      expect(store.updateMonitorScheduleAfterRun).not.toHaveBeenCalled();
    });

    it("acquires a lock and enqueues the scrape on the happy path", async () => {
      lockCredits.mockResolvedValue({
        status: "locked",
        lockId: "monitor_chk-1",
      });

      await processMonitorCheckJob(job as any);

      expect(skipQuotaPatch()).toBeUndefined();
      expect(addScrapeJobMock).toHaveBeenCalledTimes(1);
      const reservedPatch = updateMonitorCheck.mock.calls.find(
        call => call[1]?.billing_status === "reserved",
      );
      expect(reservedPatch![1]).toMatchObject({
        autumn_lock_id: "monitor_chk-1",
        reserved_credits: 5,
        billing_status: "reserved",
      });
    });
  });
});
