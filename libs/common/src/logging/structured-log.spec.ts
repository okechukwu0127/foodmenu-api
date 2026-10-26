import { ArgumentsHost } from "@nestjs/common";
import { HttpExceptionFilter } from "../filters/http-exception.filter";
import { serverErrorDetails, writeStructuredLog } from "./structured-log";

describe("structured logs", () => {
  afterEach(() => jest.restoreAllMocks());

  it("writes standalone pretty JSON without Nest prefixes", () => {
    const output = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeStructuredLog("info", "HttpRequest", { statusCode: 200 }, true);
    const raw = String(output.mock.calls[0][0]);
    expect(raw).toContain('\n  "statusCode": 200');
    expect(JSON.parse(raw)).toMatchObject({
      level: "info",
      context: "HttpRequest",
      statusCode: 200,
    });
  });

  it("supports single-line JSON errors on stderr", () => {
    const output = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeStructuredLog("error", "test", { message: "Failed" }, false);
    const raw = String(output.mock.calls[0][0]);
    expect(raw.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(raw).level).toBe("error");
  });

  it("keeps stack frames and safe database codes without raw error content", () => {
    const error = Object.assign(
      new Error("password=private-secret\naddress=private-address"),
      { code: "P2021" },
    );
    const details = serverErrorDetails(error);
    expect(details).toMatchObject({ type: "Error", code: "P2021" });
    expect(details.stack).not.toHaveLength(0);
    expect(JSON.stringify(details)).not.toContain("private-secret");
    expect(JSON.stringify(details)).not.toContain("private-address");
  });

  it("logs HTTP 500 errors with the matching request ID and preserves the response", () => {
    const output = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const response = {
      getHeader: jest.fn().mockReturnValue("request-123"),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: "POST",
      route: { path: "/api/v1/auth/signup" },
      originalUrl: "/api/v1/auth/signup",
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(new Error("secret submitted value"), host);
    const raw = String(output.mock.calls[0][0]);
    expect(JSON.parse(raw)).toMatchObject({
      level: "error",
      event: "server_error",
      requestId: "request-123",
      statusCode: 500,
    });
    expect(raw).not.toContain("secret submitted value");
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Something went wrong",
      }),
    );
  });
});
