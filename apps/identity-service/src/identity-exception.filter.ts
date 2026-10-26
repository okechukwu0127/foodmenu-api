import { Catch, HttpException, RpcExceptionFilter } from "@nestjs/common";
import { AppError } from "@app/errors";
import { RpcException } from "@nestjs/microservices";
import { Observable, throwError } from "rxjs";
import { serverErrorDetails, writeStructuredLog } from "@app/common";

@Catch()
export class IdentityExceptionFilter implements RpcExceptionFilter {
  catch(error: unknown): Observable<never> {
    if (
      (error instanceof AppError && error.statusCode >= 500) ||
      (error instanceof HttpException && error.getStatus() >= 500) ||
      !(
        error instanceof AppError ||
        error instanceof HttpException ||
        error instanceof RpcException
      )
    ) {
      writeStructuredLog("error", "IdentityService", {
        event: "server_error",
        message: "Identity service request failed",
        error: serverErrorDetails(error),
      });
    }
    if (error instanceof AppError)
      return throwError(() => ({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        details: error.details,
      }));
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === "object" && "message" in response
          ? (response as { message: string | string[] }).message
          : error.message;
      return throwError(() => ({ statusCode: error.getStatus(), message }));
    }
    if (error instanceof RpcException)
      return throwError(() => error.getError());
    // Never expose database errors or account credentials through RPC.
    return throwError(() => ({
      statusCode: 500,
      message: "Identity service request failed",
    }));
  }
}
