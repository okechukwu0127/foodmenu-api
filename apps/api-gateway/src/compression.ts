import * as compression from "compression";
import type { Request, Response } from "express";

/**
 * Gzip responses for clients that send `Accept-Encoding: gzip` (React Native
 * fetch does this automatically and decompresses transparently).
 *
 * Server-sent event streams (the AI concierge) are skipped: compression buffers
 * output, which would make streamed replies arrive in bursts. Already-compressed
 * media such as webp icons is skipped by the default filter.
 */
export function createCompressionMiddleware() {
  return compression({
    threshold: 1024,
    filter: (req: Request, res: Response) => {
      const contentType = String(res.getHeader("Content-Type") ?? "");
      if (contentType.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  });
}
