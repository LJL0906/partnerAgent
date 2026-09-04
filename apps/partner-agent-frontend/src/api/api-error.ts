import type { ApiError as ApiErrorBody } from '@partner-agent/contracts';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}
