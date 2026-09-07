import { uuid7 } from "@beesolve/helpers";

import { isAlreadyRunning, type JobRuns } from "../jobRuns.ts";

/**
 * Attempts to start a guarded run for a domain. Returns `{ started: true, runId }`
 * on success, or `{ started: false }` when a non-stale run is already in
 * progress for that domain (the tracker's `already-running` guard). Any other
 * error propagates.
 */
export async function beginRun(props: {
  readonly jobs: Pick<JobRuns, "startRun">;
  readonly domain: string;
}): Promise<{ started: true; runId: string } | { started: false }> {
  const runId = uuid7();
  const startedAt = new Date().toISOString();

  try {
    await props.jobs.startRun({ domain: props.domain, runId, startedAt });
  } catch (error) {
    if (isAlreadyRunning(error)) return { started: false };
    throw error;
  }

  return { started: true, runId };
}
