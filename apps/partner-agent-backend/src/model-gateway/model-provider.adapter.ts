import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ApprovedEgressRequest } from './egress.types.js';

/** 唯一持有 Pi provider 原始调用能力的适配器。 */
export class ModelProviderAdapter {
  constructor(
    private readonly streamApproved: (
      request: ApprovedEgressRequest,
    ) => AssistantMessageEventStream,
  ) {}

  stream(request: ApprovedEgressRequest): AssistantMessageEventStream {
    return this.streamApproved(request);
  }
}
