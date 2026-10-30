import { AppError } from "@app/errors";
import { createHash } from "crypto";
import { z } from "zod";

export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): never {
  throw new AppError(code, message, status, details);
}
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success)
    fail(
      "AI_INVALID_INPUT",
      "Invalid concierge input",
      400,
      result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  return result.data;
}
export const uuid = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());
export const empty = z.object({}).strict();
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(stable(value)).digest("hex");
export const etag = (revision: number) => `"${revision}"`;
export function matchRevision(header: string | undefined, revision: number) {
  if (!header)
    fail(
      "AI_PRECONDITION_REQUIRED",
      "Supply If-Match with the resource ETag",
      428,
    );
  if (header !== etag(revision))
    fail(
      "AI_STALE_REVISION",
      "The resource changed; fetch it before retrying",
      412,
      { revision },
    );
}

export async function withAbort<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new Error("AI_CANCELLED");
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("AI_CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
