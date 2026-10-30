import { EventEmitter } from "events";
import { Request, Response } from "express";
import {
  createRequestLoggingMiddleware,
  sanitizeRequestValue,
} from "./request-logging.middleware";

function run(options = {}) {
  const request = {
    method: "POST",
    route: { path: "/api/v1/auth/signin" },
    headers: {
      authorization: "Bearer secret",
      "x-api-key": "key",
      "content-type": "application/json",
    },
    query: { access_token: "secret" },
    body: {
      email: "private@example.com",
      password: "secret",
      nested: { verificationCode: "123456", label: "Home" },
    },
  } as unknown as Request;
  const response = Object.assign(new EventEmitter(), {
    statusCode: 401,
    writableFinished: true,
    setHeader: jest.fn(),
  });
  const logger = { log: jest.fn() };
  const next = jest.fn();
  createRequestLoggingMiddleware(options, logger)(
    request,
    response as unknown as Response,
    next,
  );
  return { request, response, logger, next };
}

describe("HTTP request logging", () => {
  it("logs failures once with a server-generated request ID, without details by default", () => {
    const { response, logger, next } = run();
    response.emit("finish");
    response.emit("close");
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logger.log.mock.calls[0][0]);
    expect(entry).toMatchObject({
      method: "POST",
      statusCode: 401,
      aborted: false,
    });
    expect(entry.headers).toBeUndefined();
    expect(entry.body).toBeUndefined();
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Request-Id",
      entry.requestId,
    );
  });

  it("redacts nested credentials, personal fields and non-allowlisted headers without changing the body", () => {
    const { request, response, logger } = run({ headers: true, body: true });
    response.emit("finish");
    const entry = JSON.parse(logger.log.mock.calls[0][0]);
    expect(entry.headers.authorization).toBe("[REDACTED]");
    expect(entry.headers["x-api-key"]).toBe("[REDACTED]");
    expect(entry.headers["content-type"]).toBe("application/json");
    expect(entry.body).toEqual({
      email: "[REDACTED]",
      password: "[REDACTED]",
      nested: { verificationCode: "[REDACTED]", label: "Home" },
    });
    expect(entry.query.access_token).toBe("[REDACTED]");
    expect(request.body.password).toBe("secret");
  });

  it("logs aborted requests and avoids exposing unmatched URL paths", () => {
    const { request, response, logger } = run();
    request.route = undefined;
    response.writableFinished = false;
    response.emit("close");
    expect(JSON.parse(logger.log.mock.calls[0][0])).toMatchObject({
      aborted: true,
      path: "[unmatched or static request]",
    });
  });

  it("omits raw webhook data and only reports file size/type", () => {
    const { request, response, logger } = run({ body: true });
    request.body = Buffer.from("private webhook payload");
    request.file = {
      mimetype: "image/png",
      size: 200,
      buffer: Buffer.from("private image"),
    } as Express.Multer.File;
    response.emit("finish");
    const entry = JSON.parse(logger.log.mock.calls[0][0]);
    expect(entry.body).toBe("[BINARY OMITTED]");
    expect(entry.file).toEqual({ mimeType: "image/png", size: 200 });
  });

  it("bounds recursive objects and large collections", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => JSON.stringify(sanitizeRequestValue(circular))).not.toThrow();
    expect(sanitizeRequestValue(Array(100).fill(1))).toHaveLength(20);
    const { request, response, logger } = run({ body: true });
    request.body = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [String(i), "x".repeat(1000)]),
    );
    response.emit("finish");
    expect(JSON.parse(logger.log.mock.calls[0][0]).body).toBe(
      "[DETAILS SIZE LIMIT]",
    );
  });
  it("omits AI chat text and sensitive preference answers even in verbose logs", () => {
    const { request, response, logger } = run({ body: true, headers: true });
    request.originalUrl = "/api/v1/ai/chat";
    request.body = {
      text: "private medical information",
      answers: { diet: "private preference" },
    };
    response.emit("finish");
    const raw = logger.log.mock.calls[0][0];
    expect(raw).not.toContain("private medical information");
    expect(raw).not.toContain("private preference");
    expect(JSON.parse(raw).body).toBe("[AI CONTENT OMITTED]");
  });
  it.each([
    [400, false, true],
    [503, false, true],
    [200, true, true],
    [200, false, false],
  ])(
    "routes status %s / aborted %s to the appropriate severity",
    (status, aborted, failed) => {
      const { request, response } = run();
      response.statusCode = status as number;
      response.writableFinished = !aborted;
      const logger = { log: jest.fn(), error: jest.fn() };
      createRequestLoggingMiddleware({}, logger)(
        request,
        response as unknown as Response,
        jest.fn(),
      );
      response.emit(aborted ? "close" : "finish");
      expect(logger.error).toHaveBeenCalledTimes(failed ? 1 : 0);
      expect(logger.log).toHaveBeenCalledTimes(failed ? 0 : 1);
    },
  );
});
