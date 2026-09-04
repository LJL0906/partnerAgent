import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitPrivacyDecision, type PrivacyDecision } from './privacy-api';

const mocks = vi.hoisted(() => ({
  createCommandEnvelope: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock('./command-envelope', () => ({
  createCommandEnvelope: mocks.createCommandEnvelope,
}));
vi.mock('./http-client', () => ({ postJson: mocks.postJson }));
vi.mock('./config', () => ({
  apiConfig: { submitPrivacyDecisionPath: '/api/v1/privacy-decisions/submit' },
}));

describe('privacy API', () => {
  beforeEach(() => {
    mocks.createCommandEnvelope.mockReset();
    mocks.postJson.mockReset();
    mocks.createCommandEnvelope.mockImplementation(async (payload, options) => ({
      operation_id: options.operationId,
      client_source: 'web',
      request_fingerprint: 'fingerprint',
      payload,
    }));
    mocks.postJson.mockResolvedValue({ operation_id: 'operation-1', status: 'accepted' });
  });

  it.each<PrivacyDecision>(['allow', 'redact', 'block'])(
    'submits the %s decision through the unified command endpoint',
    async (decision) => {
      const signal = new AbortController().signal;

      await expect(
        submitPrivacyDecision({
          egressId: 'egress-1',
          decision,
          operationId: 'operation-1',
          signal,
        }),
      ).resolves.toEqual({ operation_id: 'operation-1', status: 'accepted' });

      expect(mocks.createCommandEnvelope).toHaveBeenCalledWith(
        { egress_id: 'egress-1', decision },
        { operationId: 'operation-1' },
      );
      expect(mocks.postJson).toHaveBeenCalledWith(
        '/api/v1/privacy-decisions/submit',
        expect.objectContaining({ payload: { egress_id: 'egress-1', decision } }),
        { signal },
      );
    },
  );
});
