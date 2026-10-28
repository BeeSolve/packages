export interface SecurityRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type SecurityRunner = (args: ReadonlyArray<string>) => Promise<SecurityRunResult>;

/** Default runner: invokes the macOS `/usr/bin/security` binary via `Bun.spawn`. */
export const defaultSecurityRunner: SecurityRunner = async (args) => {
  const child = Bun.spawn(["/usr/bin/security", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const exitCode = await child.exited;
  return { exitCode, stdout, stderr };
};

/** Throw a clear error when the keychain backend is used on a non-macOS platform. */
export function assertDarwin(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") {
    throw new Error(
      `@beesolve/aws-env-resolver keychain is macOS-only; got platform "${platform}". Non-macOS platforms fall back to fetching secrets fresh on every run.`,
    );
  }
}

export async function addGenericPassword(props: {
  readonly account: string;
  readonly service: string;
  readonly secret: string;
  readonly trusted: boolean;
  readonly runner?: SecurityRunner;
  readonly platform?: NodeJS.Platform;
}): Promise<void> {
  assertDarwin(props.platform);
  const runner = props.runner ?? defaultSecurityRunner;
  const trustArg = props.trusted ? "/usr/bin/security" : "";
  const result = await runner([
    "add-generic-password",
    "-a",
    props.account,
    "-s",
    props.service,
    "-w",
    props.secret,
    "-U",
    "-T",
    trustArg,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to store keychain item for account "${props.account}" (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
}

export async function findGenericPassword(props: {
  readonly account: string;
  readonly service: string;
  readonly runner?: SecurityRunner;
  readonly platform?: NodeJS.Platform;
}): Promise<string | undefined> {
  assertDarwin(props.platform);
  const runner = props.runner ?? defaultSecurityRunner;
  const result = await runner([
    "find-generic-password",
    "-a",
    props.account,
    "-s",
    props.service,
    "-w",
  ]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.replace(/\n$/, "");
}

export async function deleteGenericPassword(props: {
  readonly account: string;
  readonly service: string;
  readonly runner?: SecurityRunner;
  readonly platform?: NodeJS.Platform;
}): Promise<void> {
  assertDarwin(props.platform);
  const runner = props.runner ?? defaultSecurityRunner;
  const result = await runner([
    "delete-generic-password",
    "-a",
    props.account,
    "-s",
    props.service,
  ]);
  if (result.exitCode === 0) {
    return;
  }
  if (isNotFound(result)) {
    return;
  }
  throw new Error(
    `Failed to delete keychain item for account "${props.account}" (exit ${result.exitCode}): ${result.stderr.trim()}`,
  );
}

function isNotFound(result: SecurityRunResult): boolean {
  return /could not be found|SecKeychainSearchCopyNext|item could not be found/i.test(
    result.stderr,
  );
}
