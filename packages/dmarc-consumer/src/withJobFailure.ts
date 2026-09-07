import { errorMessage } from "../errorMessage.ts";
import type { JobRuns } from "../jobRuns.ts";

/**
 * Runs `body`; if it throws, marks the run `failed` (recording the error) via
 * the job tracker and rethrows the original error.
 */
export async function withJobFailure(
  props: {
    readonly jobs: Pick<JobRuns, "failRun">;
    readonly domain: string;
    readonly runId: string;
  },
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (error) {
    await props.jobs.failRun({
      domain: props.domain,
      runId: props.runId,
      error: errorMessage(error),
    });
    throw error;
  }
}
