import { HttpException, HttpStatus } from '@nestjs/common';
import type { JsonObject } from './confirmation-transaction.types.js';

export function confirmationError(
  code: string,
  message: string,
  status: number,
  details?: JsonObject,
): HttpException {
  return new HttpException(
    { code, message, ...(details ? { details } : {}) },
    status as HttpStatus,
  );
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw confirmationError('VALIDATION_002', `缺少 ${field}`, 422, { field });
  }
  return value;
}

export function requiredUuid(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  ) {
    throw confirmationError('VALIDATION_001', `${field} 必须是 UUID`, 422, {
      field,
    });
  }
  return result;
}
