import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

export type CommandEnvelopeBody = {
  operation_id?: string;
  payload?: unknown;
  [key: string]: unknown;
};

export interface LocalCoreRequest {
  userId: string;
  input: Record<string, unknown>;
}

export interface LocalCoreCommandRequest extends LocalCoreRequest {
  envelope: CommandEnvelopeBody;
}
