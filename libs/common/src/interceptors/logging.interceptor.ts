import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
    }>();
    const method = request.method ?? "TCP";
    const url = request.originalUrl ?? request.url ?? context.getHandler().name;

    return next.handle().pipe(
      tap(() => {
        this.logger.log(`${method} ${url} ${Date.now() - startedAt}ms`);
      }),
    );
  }
}
