import {
  HttpException,
  HttpStatus,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalCoreApiModule } from '../src/local-core-api/local-core-api.module.js';
import { LocalCoreApplicationPort } from '../src/local-core-api/local-core-application.port.js';
import type {
  LocalCoreCommandRequest,
  LocalCoreRequest,
} from '../src/local-core-api/local-core-api.types.js';

interface CommandRoute {
  path: string;
  handler: string;
  implemented?: boolean;
}

interface QueryRoute {
  method: 'get' | 'post';
  path: string;
  handler: string;
  implemented?: boolean;
}

const commandRoutes: CommandRoute[] = [
  { path: '/api/v1/inputs/text', handler: 'SubmitTextInput' },
  { path: '/api/v1/inputs/voice', handler: 'SubmitVoiceInput' },
  { path: '/api/v1/voice-drafts/upsert', handler: 'CreateOrUpdateVoiceDraft' },
  { path: '/api/v1/voice-drafts/cancel', handler: 'CancelVoiceDraft' },
  { path: '/api/v1/attachments/submit', handler: 'SubmitAttachmentInput' },
  { path: '/api/v1/analysis-runs/cancel', handler: 'CancelAnalysis' },
  { path: '/api/v1/tasks/cancel', handler: 'CancelTask' },
  { path: '/api/v1/original-records/reanalyze', handler: 'RequestReanalysis' },
  {
    path: '/api/v1/attachments/supplement-analysis',
    handler: 'RequestAttachmentSupplementAnalysis',
  },
  { path: '/api/v1/model-configs/upsert', handler: 'UpsertModelConfig' },
  { path: '/api/v1/model-configs/delete', handler: 'DeleteModelConfig' },
  { path: '/api/v1/model-configs/reorder', handler: 'ReorderModelConfigs' },
  { path: '/api/v1/model-configs/set-default', handler: 'SetDefaultModel' },
  {
    path: '/api/v1/messages/set-model-selection',
    handler: 'SetMessageModelSelection',
  },
  { path: '/api/v1/model-connections/test', handler: 'TestModelConnection' },
  { path: '/api/v1/model-tasks/start', handler: 'StartBusinessModelTask' },
  {
    path: '/api/v1/privacy-decisions/submit',
    handler: 'SubmitPrivacyDecision',
  },
  { path: '/api/v1/suggestions/feedback', handler: 'RecordSuggestionFeedback' },
  {
    path: '/api/v1/confirmation-batches/submit',
    handler: 'SubmitConfirmationBatch',
    implemented: true,
  },
  {
    path: '/api/v1/reminder-instances/close',
    handler: 'CloseReminderInstance',
  },
  {
    path: '/api/v1/reminder-instances/snooze',
    handler: 'SnoozeReminderInstance',
  },
  { path: '/api/v1/reminder-plans/update', handler: 'UpdateReminderPlan' },
  {
    path: '/api/v1/reminder-candidates/create',
    handler: 'CreateReminderActionCandidate',
  },
  {
    path: '/api/v1/notification-results/register',
    handler: 'RegisterNotificationResult',
  },
  { path: '/api/v1/export-previews/create', handler: 'PreviewExport' },
  { path: '/api/v1/exports/start', handler: 'StartExport' },
  { path: '/api/v1/exports/cancel', handler: 'CancelExport' },
  { path: '/api/v1/exports/retry', handler: 'RetryExport' },
  { path: '/api/v1/exports/download-result', handler: 'DownloadExportResult' },
  { path: '/api/v1/indexes/rebuild', handler: 'RebuildIndex' },
  {
    path: '/api/v1/context-snapshots/refresh',
    handler: 'RefreshContextSnapshot',
  },
  { path: '/api/v1/facts/mark-incorrect', handler: 'MarkFactIncorrect' },
  {
    path: '/api/v1/object-change-candidates/archive',
    handler: 'CreateArchiveObjectCandidate',
  },
  {
    path: '/api/v1/object-change-candidates/soft-delete',
    handler: 'CreateSoftDeleteObjectCandidate',
  },
  {
    path: '/api/v1/object-change-candidates/restore',
    handler: 'CreateRestoreObjectCandidate',
  },
  {
    path: '/api/v1/object-change-candidates/permanently-delete',
    handler: 'CreatePermanentDeleteObjectCandidate',
  },
];

const queryRoutes: QueryRoute[] = [
  {
    method: 'get',
    path: '/api/v1/chat-sessions/route-session',
    handler: 'GetChatSession',
    implemented: true,
  },
  { method: 'get', path: '/api/v1/original-records/route-id', handler: 'GetOriginalRecord' },
  { method: 'get', path: '/api/v1/attachments/route-id/status', handler: 'GetAttachmentStatus' },
  { method: 'get', path: '/api/v1/analysis-runs/route-id', handler: 'GetAnalysisRun' },
  { method: 'get', path: '/api/v1/tasks/route-id', handler: 'GetTaskStatus' },
  {
    method: 'get',
    path: '/api/v1/core/health',
    handler: 'GetCoreHealth',
    implemented: true,
  },
  { method: 'get', path: '/api/v1/confirmation-batches?status=pending', handler: 'ListPendingConfirmationBatches' },
  { method: 'get', path: '/api/v1/confirmation-batches/route-id', handler: 'GetConfirmationBatch' },
  { method: 'get', path: '/api/v1/candidates/route-id', handler: 'GetCandidateDetail' },
  { method: 'get', path: '/api/v1/confirmation-history', handler: 'GetConfirmationHistory' },
  { method: 'get', path: '/api/v1/objects/goal/route-id/undo-eligibility', handler: 'GetUndoEligibility' },
  { method: 'get', path: '/api/v1/goals', handler: 'ListGoals' },
  { method: 'get', path: '/api/v1/goals/route-id', handler: 'GetGoal' },
  { method: 'get', path: '/api/v1/actions', handler: 'ListActions' },
  { method: 'get', path: '/api/v1/actions/route-id', handler: 'GetAction' },
  { method: 'get', path: '/api/v1/facts', handler: 'ListFacts' },
  { method: 'get', path: '/api/v1/facts/route-id', handler: 'GetFact' },
  { method: 'get', path: '/api/v1/memories', handler: 'ListMemories' },
  { method: 'get', path: '/api/v1/memories/route-id', handler: 'GetMemory' },
  { method: 'get', path: '/api/v1/decisions', handler: 'ListDecisions' },
  { method: 'get', path: '/api/v1/decisions/route-id', handler: 'GetDecision' },
  { method: 'get', path: '/api/v1/context-snapshot', handler: 'GetContextSnapshot' },
  { method: 'get', path: '/api/v1/objects/goal/route-id/history', handler: 'GetChangeHistory' },
  { method: 'post', path: '/api/v1/relevant-context/search', handler: 'SearchRelevantContext' },
  { method: 'get', path: '/api/v1/suggestions/route-id/evidence', handler: 'GetSuggestionEvidence' },
  { method: 'get', path: '/api/v1/indexes/health', handler: 'GetIndexHealth' },
  { method: 'get', path: '/api/v1/indexes/rebuild-status', handler: 'GetIndexRebuildStatus' },
  { method: 'get', path: '/api/v1/summaries/daily', handler: 'GetDailySummary' },
  { method: 'get', path: '/api/v1/reviews/weekly', handler: 'GetWeeklyReview' },
  { method: 'get', path: '/api/v1/reminders', handler: 'ListReminders' },
  { method: 'get', path: '/api/v1/reminder-instances/route-id', handler: 'GetReminderInstance' },
  { method: 'get', path: '/api/v1/reminder-candidates?status=pending', handler: 'ListPendingReminderCandidates' },
  { method: 'get', path: '/api/v1/model-configs', handler: 'ListModelConfigs' },
  { method: 'get', path: '/api/v1/model-runtime/status', handler: 'GetModelRuntimeStatus' },
  { method: 'get', path: '/api/v1/privacy-policy/status', handler: 'GetPrivacyPolicyStatus' },
  { method: 'get', path: '/api/v1/export-preview?preview_token=route-token', handler: 'GetExportPreview' },
  { method: 'get', path: '/api/v1/exports/route-id', handler: 'GetExportTask' },
];

if (commandRoutes.length !== 36 || queryRoutes.length !== 37) {
  throw new Error('Local Core 路由表必须保持 36 Command + 37 Query');
}

const secret = 'route-table-secret-that-is-at-least-32-bytes';

describe('Local Core registered route table (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const executeCommand = vi.fn(
    (handler: string, commandRequest: LocalCoreCommandRequest) => {
      if (handler === 'SubmitConfirmationBatch') {
        return Promise.resolve({
          operation_id: commandRequest.envelope.operation_id,
          status: 'completed',
          handler,
        });
      }
      return Promise.reject(
        new HttpException(
          {
            code: 'NOT_IMPLEMENTED_001',
            message: `${handler} 尚未实现`,
            details: {
              handler_kind: 'command',
              handler,
              operation_id: commandRequest.envelope.operation_id,
            },
          },
          HttpStatus.NOT_IMPLEMENTED,
        ),
      );
    },
  );
  const executeQuery = vi.fn((handler: string, queryRequest: LocalCoreRequest) => {
    if (handler === 'GetCoreHealth' || handler === 'GetChatSession') {
      return Promise.resolve({ handler, owner: queryRequest.userId });
    }
    return Promise.reject(
      new HttpException(
        {
          code: 'NOT_IMPLEMENTED_001',
          message: `${handler} 尚未实现`,
          details: { handler_kind: 'query', handler },
        },
        HttpStatus.NOT_IMPLEMENTED,
      ),
    );
  });

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = secret;
    process.env.SESSION_STORE = 'memory';
    const moduleFixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LocalCoreApiModule],
    })
      .overrideProvider(LocalCoreApplicationPort)
      .useValue({ executeCommand, executeQuery })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    token = await createToken('trusted-route-owner');
  });

  beforeEach(() => {
    executeCommand.mockClear();
    executeQuery.mockClear();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.SESSION_STORE;
  });

  it.each(commandRoutes)('$handler is registered with the expected status', async ({
    path,
    handler,
    implemented,
  }) => {
    const operationId = `operation-${handler}`;
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operation_id: operationId,
        client_source: 'web',
        request_fingerprint: `fingerprint-${handler}`,
        user_id: 'forged-envelope-user',
        userId: 'forged-envelope-user',
        payload: {
          value: 'route-test',
          user_id: 'forged-payload-user',
          userId: 'forged-payload-user',
        },
      });

    expect(response.status).not.toBe(404);
    expect(response.status).toBe(implemented ? 200 : 501);
    if (implemented) {
      expect(response.body).toMatchObject({
        status: 'completed',
        handler,
        operation_id: operationId,
      });
    } else {
      expect(response.body).toMatchObject({
        code: 'NOT_IMPLEMENTED_001',
        details: {
          handler_kind: 'command',
          handler,
          operation_id: operationId,
        },
      });
    }
    expect(executeCommand).toHaveBeenCalledOnce();
    const dispatched = executeCommand.mock.calls[0][1];
    expect(dispatched.userId).toBe('trusted-route-owner');
    expect(dispatched.envelope).not.toHaveProperty('user_id');
    expect(dispatched.envelope).not.toHaveProperty('userId');
    expect(dispatched.envelope.payload).not.toHaveProperty('user_id');
    expect(dispatched.envelope.payload).not.toHaveProperty('userId');
  });

  it.each(queryRoutes)('$handler is registered with the expected status', async ({
    method,
    path,
    handler,
    implemented,
  }) => {
    const separator = path.includes('?') ? '&' : '?';
    const pathWithForgery = `${path}${separator}user_id=forged-query-user&userId=forged-query-user`;
    const builder =
      method === 'post'
        ? request(app.getHttpServer())
            .post(pathWithForgery)
            .send({
              value: 'route-test',
              user_id: 'forged-body-user',
              userId: 'forged-body-user',
            })
        : request(app.getHttpServer()).get(pathWithForgery);
    const response = await builder.set('Authorization', `Bearer ${token}`);

    expect(response.status).not.toBe(404);
    expect(response.status).toBe(implemented ? 200 : 501);
    if (implemented) {
      expect(response.body).toMatchObject({
        handler,
        owner: 'trusted-route-owner',
      });
    } else {
      expect(response.body).toMatchObject({
        code: 'NOT_IMPLEMENTED_001',
        details: { handler_kind: 'query', handler },
      });
    }
    expect(executeQuery).toHaveBeenCalledOnce();
    const dispatched = executeQuery.mock.calls[0][1];
    expect(dispatched.userId).toBe('trusted-route-owner');
    expect(dispatched.input).not.toHaveProperty('user_id');
    expect(dispatched.input).not.toHaveProperty('userId');
  });
});

async function createToken(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
