export async function spawnCommand(props: {
  readonly command: ReadonlyArray<string>;
  readonly env: Record<string, string>;
}): Promise<number> {
  if (props.command.length === 0) {
    throw new Error("spawnCommand requires a non-empty command");
  }

  const child = Bun.spawn([...props.command], {
    env: { ...process.env, ...props.env },
    stdio: ["inherit", "inherit", "inherit"],
  });

  const forwardSigint = (): void => {
    child.kill("SIGINT");
  };
  const forwardSigterm = (): void => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", forwardSigint);
  process.on("SIGTERM", forwardSigterm);

  try {
    return await child.exited;
  } finally {
    process.off("SIGINT", forwardSigint);
    process.off("SIGTERM", forwardSigterm);
  }
}
