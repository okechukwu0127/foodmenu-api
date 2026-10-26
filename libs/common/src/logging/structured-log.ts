export function writeStructuredLog(
  level: "info" | "error",
  context: string,
  fields: Record<string, unknown>,
  pretty = process.env.LOG_PRETTY !== "false" &&
    process.env.NODE_ENV !== "production",
): void {
  const entry = {
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    context,
  };
  const output = JSON.stringify(entry, null, pretty ? 2 : undefined) + "\n";
  (level === "error" ? process.stderr : process.stdout).write(output);
}

// Database/provider messages can contain submitted values and credentials.
// Keep stack frames for debugging without copying the raw error message.
export function serverErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: "UnknownError" };
  const code = (error as Error & { code?: unknown }).code;
  return {
    type: error.constructor.name,
    code:
      typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)
        ? code
        : undefined,
    stack: error.stack
      ?.split("\n")
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 20),
  };
}
