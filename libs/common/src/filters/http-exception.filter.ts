import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import type { Request } from "express";
import { AppError } from "@app/errors";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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

    if (statusCode >= 500) {
      this.logger.error(message, exception instanceof Error ? exception.stack : undefined);
    }

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
    if (
      response &&
      typeof response === "object" &&
      "message" in response
    ) {
      const message = (response as { message: string | string[] }).message;
      return Array.isArray(message) ? message.join(", ") : message;
    }
    return exception.message;
  }
}
