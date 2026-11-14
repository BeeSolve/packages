import type { AccessManifest } from "./manifest";
import { type AccessPlan, planAccess } from "./plan";
import { readAccessState, type SqlClient } from "./state";

export type ReconcileAccessProps = {
  /** Connected as `admin` (IAM `dsql:DbConnectAdmin`). */
  readonly client: SqlClient;
  readonly manifest: AccessManifest;
  /** Revoke and drop roles that are mapped to IAM principals but not declared. Default `false`. */
  readonly prune?: boolean;
  /** Print the plan without running it. Default `false`. */
  readonly dryRun?: boolean;
  /** Receives one line per statement, warning and problem. Defaults to `console.log`. */
  readonly log?: (line: string) => void;
};

export class AccessReconcileError extends Error {
  readonly problems: ReadonlyArray<string>;

  constructor(message: string, problems: ReadonlyArray<string>) {
    super(`${message}\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "AccessReconcileError";
    this.problems = problems;
  }
}

/**
 * Makes the cluster's roles, table privileges and IAM mappings match the manifest, then reads
 * the state again and fails unless nothing is left to do. Safe to re-run: the plan is a diff.
 * Run it after migrations, so roles without a table list also cover newly created tables.
 */
export async function reconcileAccess(props: ReconcileAccessProps): Promise<AccessPlan> {
  const { client, manifest } = props;
  const prune = props.prune ?? false;
  const log = props.log ?? ((line: string) => console.log(line));

  const plan = planAccess({
    manifest,
    state: await readAccessState({ client, manifest, prune }),
    prune,
  });
  for (const warning of plan.warnings) {
    log(`warning: ${warning}`);
  }
  if (plan.problems.length > 0) {
    throw new AccessReconcileError("The access manifest cannot be applied:", plan.problems);
  }
  if (plan.statements.length === 0) {
    log("Access is up to date.");
    return plan;
  }

  for (const statement of plan.statements) {
    log(`${props.dryRun ? "-- would run: " : "> "}${statement}`);
    if (!props.dryRun) {
      await client.query(statement);
    }
  }
  if (props.dryRun) {
    return plan;
  }

  const verification = planAccess({
    manifest,
    state: await readAccessState({ client, manifest, prune }),
    prune,
  });
  const remaining = [
    ...verification.problems,
    ...verification.statements.map((statement) => `still pending: ${statement}`),
  ];
  if (remaining.length > 0) {
    throw new AccessReconcileError(
      "Access does not match the manifest after applying it:",
      remaining,
    );
  }
  log("Access matches the manifest.");
  return plan;
}
