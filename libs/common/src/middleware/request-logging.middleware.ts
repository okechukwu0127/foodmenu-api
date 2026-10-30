import { Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { RequestHandler } from "express";
import { writeStructuredLog } from "../logging/structured-log";

const sensitiveKey =
  /password|secret|token|authorization|cookie|code|credential|signature|address|email|phone|name|latitude|longitude|card|cvc|cvv|photo|image|buffer/i;
const safeHeaders = new Set([
  "content-type",
  "content-length",
  "accept",
  "accept-encoding",
  "accept-language",
  "user-agent",
  "host",
  "connection",
]);

// Bound recursion, collection sizes and total output. Never mutate the request.
export function sanitizeRequestValue(value: unknown, depth = 0): unknown {
  if (Buffer.isBuffer(value)) return "[BINARY OMITTED]";
  if (depth >= 6) return "[DEPTH LIMIT]";
  if (typeof value === "string") return value.slice(0, 1000);
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeRequestValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key.slice(0, 100),
          sensitiveKey.test(key)
            ? "[REDACTED]"
            : sanitizeRequestValue(item, depth + 1),
        ]),
    );
  }
  return value;
}

function boundedDetails(value: unknown): unknown {
  const sanitized = sanitizeRequestValue(value);
  return JSON.stringify(sanitized)?.length > 16000
    ? "[DETAILS SIZE LIMIT]"
    : sanitized;
}

export function createRequestLoggingMiddleware(
  options: { headers?: boolean; body?: boolean } = {},
  logger?: Pick<Logger, "log"> & Partial<Pick<Logger, "error">>,
): RequestHandler {
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    let logged = false;
    const log = (aborted: boolean) => {
      if (logged) return;
      logged = true;
      const failed = aborted || response.statusCode >= 400;
      const entry: Record<string, unknown> = {
        event: failed ? "http_request_failed" : "http_request_completed",
        requestId,
        method: request.method,
        // Route templates avoid logging personal data embedded in URL parameters.
        path: request.route?.path ?? "[unmatched or static request]",
        statusCode: response.statusCode,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        aborted,
      };
      if (options.headers) {
        entry.headers = boundedDetails(
          Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              safeHeaders.has(key.toLowerCase()) ? value : "[REDACTED]",
            ]),
          ),
        );
      }
      if (options.body) {
        const aiRequest = /^\/api\/v1\/ai(?:\/|$)/.test(
          request.originalUrl ?? request.url,
        );
        entry.query = aiRequest
          ? "[AI CONTENT OMITTED]"
          : boundedDetails(request.query);
        entry.body = aiRequest
          ? "[AI CONTENT OMITTED]"
          : boundedDetails(request.body);
        if (request.file) {
          entry.file = {
            mimeType: request.file.mimetype,
            size: request.file.size,
          };
        }
      }
      if (logger) {
        if (failed && logger.error) logger.error(JSON.stringify(entry));
        else logger.log(JSON.stringify(entry));
      } else
        writeStructuredLog(failed ? "error" : "info", "HttpRequest", entry);
    };
    response.once("finish", () => log(false));
    response.once("close", () => log(!response.writableFinished));
    next();
  };
}
