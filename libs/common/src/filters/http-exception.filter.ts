import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import type { Request } from "express";
import { AppError } from "@app/errors";
import {
  serverErrorDetails,
  writeStructuredLog,
} from "../logging/structured-log";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof AppError
          ? exception.statusCode
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof AppError
        ? exception.message
        : exception instanceof HttpException
          ? this.getHttpExceptionMessage(exception)
          : "Something went wrong";
    const code =
      exception instanceof AppError
        ? exception.code
        : statusCode === HttpStatus.INTERNAL_SERVER_ERROR
          ? "INTERNAL_SERVER_ERROR"
          : "REQUEST_FAILED";

    writeStructuredLog("error", "HttpExceptionFilter", {
      event: statusCode >= 500 ? "server_error" : "http_response_error",
      requestId: response.getHeader("X-Request-Id"),
      method: request.method,
      path: request.route?.path ?? "[unmatched request]",
      statusCode,
      code,
      message: statusCode >= 500 ? "Server request failed" : "Request rejected",
      response: { success: false, statusCode, error: { code } },
      // Keep response details and free-text messages out of operational logs.
      // They can contain submitted values, preference notes or provider data.
      error: statusCode >= 500 ? serverErrorDetails(exception) : undefined,
    });

    response.status(statusCode).json({
      error: {
        code,
        details: exception instanceof AppError ? exception.details : undefined,
      },
      message,
      path: request.originalUrl ?? request.url,
      status: "error",
      statusCode,
      success: false,
      timestamp: new Date().toISOString(),
    });
  }

  private getHttpExceptionMessage(exception: HttpException) {
    const response = exception.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "message" in response) {
      const message = (response as { message: string | string[] }).message;
      return Array.isArray(message) ? message.join(", ") : message;
    }
    return exception.message;
  }
}
