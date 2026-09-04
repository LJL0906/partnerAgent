import type { ApiError as ApiErrorBody } from '@partner-agent/contracts';

export type ApiClientErrorKind =
  | 'configuration'
  | 'network'
  | 'unauthenticated'
  | 'forbidden'
  | 'http'
  | 'aborted';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorBody,
    readonly kind: ApiClientErrorKind = inferKind(status),
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function inferKind(status: number): ApiClientErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 0) return 'network';
  return 'http';
}
