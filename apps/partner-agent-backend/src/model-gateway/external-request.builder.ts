import { Injectable } from '@nestjs/common';
import type { Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type {
  EgressRequestMetadata,
  ExternalModelRequest,
} from './egress.types.js';

@Injectable()
export class ExternalRequestBuilder {
  build(
    metadata: EgressRequestMetadata,
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
  ): ExternalModelRequest {
    return { metadata: { ...metadata }, model, context, options };
  }
}
