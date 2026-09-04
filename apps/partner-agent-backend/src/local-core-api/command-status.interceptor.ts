import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';

@Injectable()
export class CommandStatusInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap((result: unknown) => {
        response.status(this.readStatus(result) === 'accepted' ? 202 : 200);
      }),
    );
  }

  private readStatus(result: unknown): string | undefined {
    if (!result || typeof result !== 'object' || !('status' in result)) {
      return undefined;
    }
    return typeof result.status === 'string' ? result.status : undefined;
  }
}
