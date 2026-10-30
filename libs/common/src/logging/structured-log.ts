export function writeStructuredLog(
  level: "info" | "error",
  context: string,
  fields: Record<string, unknown>,
  pretty = process.env.LOG_PRETTY !== "false" &&
    process.env.NODE_ENV !== "production",
  color: "auto" | "always" | "never" = (process.env.LOG_COLOR as
    "auto" | "always" | "never") ?? "auto",
): void {
  const entry = {
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    context,
  };
  const output = JSON.stringify(entry, null, pretty ? 2 : undefined) + "\n";
  const stream = level === "error" ? process.stderr : process.stdout;
  const useRed =
    level === "error" &&
    process.env.NO_COLOR === undefined &&
    (color === "always" || (color === "auto" && Boolean(stream.isTTY)));
  // Color each line so process-manager prefixes cannot reset the rest of a
  // pretty-printed JSON block back to the default terminal color.
  stream.write(
    useRed
      ? output
          .trimEnd()
          .split("\n")
          .map((line) => `\u001b[31m${line}\u001b[0m`)
          .join("\n") + "\n"
      : output,
  );
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
