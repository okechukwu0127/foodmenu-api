import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { map, Observable } from "rxjs";
import { successResponse } from "../responses/api-response";

@Injectable()
export class ApiResponseInterceptor<TData>
  implements NestInterceptor<TData, ReturnType<typeof successResponse<TData>>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<TData>,
  ): Observable<ReturnType<typeof successResponse<TData>>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((data) =>
        successResponse("Request successful", data, {
          path: request.originalUrl ?? request.url,
          statusCode: response.statusCode,
        }),
      ),
    );
  }
}
