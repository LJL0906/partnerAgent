import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CommandStatusInterceptor } from './command-status.interceptor.js';
import { HttpAuthGuard } from './http-auth.guard.js';
import { LocalCoreApplicationPort } from './local-core-application.port.js';
import type {
  AuthenticatedRequest,
  CommandEnvelopeBody,
} from './local-core-api.types.js';

@Controller('api/v1')
@UseGuards(HttpAuthGuard)
@UseInterceptors(CommandStatusInterceptor)
export class LocalCoreCommandController {
  constructor(private readonly application: LocalCoreApplicationPort) {}

  private command(
    name: string,
    request: AuthenticatedRequest,
    envelope: CommandEnvelopeBody,
  ): Promise<unknown> {
    this.validateEnvelope(envelope);
    const {
      user_id: _ignoredUserId,
      userId: _ignoredCamelUserId,
      ...trustedEnvelope
    } = envelope;
    const payload = envelope.payload;
    const sanitizedPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? this.withoutClientIdentity(payload as Record<string, unknown>)
        : payload;
    return this.application.executeCommand(name, {
      userId: request.userId,
      envelope: { ...trustedEnvelope, payload: sanitizedPayload },
      input: {},
    });
  }

  private validateEnvelope(envelope: CommandEnvelopeBody): void {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new HttpException(
        {
          code: 'VALIDATION_001',
          message: 'CommandEnvelope 必须是对象',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const required = [
      'operation_id',
      'client_source',
      'request_fingerprint',
      'payload',
    ] as const;
    const missing = required.filter(
      (field) => !Object.prototype.hasOwnProperty.call(envelope, field),
    );
    if (missing.length > 0) {
      throw new HttpException(
        {
          code: 'VALIDATION_002',
          message: 'CommandEnvelope 缺少必填字段',
          details: { fields: missing },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const validSource = ['ios', 'android', 'web', 'other'].includes(
      String(envelope.client_source),
    );
    if (
      typeof envelope.operation_id !== 'string' ||
      !envelope.operation_id.trim() ||
      typeof envelope.request_fingerprint !== 'string' ||
      !envelope.request_fingerprint.trim() ||
      !validSource ||
      envelope.payload === null ||
      typeof envelope.payload !== 'object' ||
      Array.isArray(envelope.payload)
    ) {
      throw new HttpException(
        {
          code: 'VALIDATION_001',
          message: 'CommandEnvelope 字段类型或取值无效',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private withoutClientIdentity(input: Record<string, unknown>) {
    const {
      user_id: _ignoredUserId,
      userId: _ignoredCamelUserId,
      ...trustedInput
    } = input;
    return trustedInput;
  }

  @Post('inputs/text')
  @HttpCode(200)
  submitTextInput(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SubmitTextInput', r, b);
  }

  @Post('inputs/voice')
  @HttpCode(200)
  submitVoiceInput(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SubmitVoiceInput', r, b);
  }

  @Post('voice-drafts/upsert')
  @HttpCode(200)
  upsertVoiceDraft(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CreateOrUpdateVoiceDraft', r, b);
  }

  @Post('voice-drafts/cancel')
  @HttpCode(200)
  cancelVoiceDraft(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CancelVoiceDraft', r, b);
  }

  @Post('attachments/submit')
  @HttpCode(200)
  submitAttachment(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SubmitAttachmentInput', r, b);
  }

  @Post('analysis-runs/cancel')
  @HttpCode(200)
  cancelAnalysis(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CancelAnalysis', r, b);
  }

  @Post('tasks/cancel')
  @HttpCode(200)
  cancelTask(@Req() r: AuthenticatedRequest, @Body() b: CommandEnvelopeBody) {
    return this.command('CancelTask', r, b);
  }

  @Post('original-records/reanalyze')
  @HttpCode(200)
  requestReanalysis(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('RequestReanalysis', r, b);
  }

  @Post('attachments/supplement-analysis')
  @HttpCode(200)
  requestAttachmentSupplementAnalysis(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('RequestAttachmentSupplementAnalysis', r, b);
  }

  @Post('model-configs/upsert')
  @HttpCode(200)
  upsertModelConfig(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('UpsertModelConfig', r, b);
  }

  @Post('model-configs/delete')
  @HttpCode(200)
  deleteModelConfig(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('DeleteModelConfig', r, b);
  }

  @Post('model-configs/reorder')
  @HttpCode(200)
  reorderModelConfigs(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('ReorderModelConfigs', r, b);
  }

  @Post('model-configs/set-default')
  @HttpCode(200)
  setDefaultModel(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SetDefaultModel', r, b);
  }

  @Post('messages/set-model-selection')
  @HttpCode(200)
  setMessageModelSelection(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SetMessageModelSelection', r, b);
  }

  @Post('model-connections/test')
  @HttpCode(200)
  testModelConnection(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('TestModelConnection', r, b);
  }

  @Post('model-tasks/start')
  @HttpCode(200)
  startBusinessModelTask(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('StartBusinessModelTask', r, b);
  }

  @Post('privacy-decisions/submit')
  @HttpCode(200)
  submitPrivacyDecision(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SubmitPrivacyDecision', r, b);
  }

  @Post('suggestions/feedback')
  @HttpCode(200)
  recordSuggestionFeedback(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('RecordSuggestionFeedback', r, b);
  }

  @Post('confirmation-batches/submit')
  @HttpCode(200)
  submitConfirmationBatch(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SubmitConfirmationBatch', r, b);
  }

  @Post('reminder-instances/close')
  @HttpCode(200)
  closeReminderInstance(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CloseReminderInstance', r, b);
  }

  @Post('reminder-instances/snooze')
  @HttpCode(200)
  snoozeReminderInstance(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('SnoozeReminderInstance', r, b);
  }

  @Post('reminder-plans/update')
  @HttpCode(200)
  updateReminderPlan(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('UpdateReminderPlan', r, b);
  }

  @Post('reminder-candidates/create')
  @HttpCode(200)
  createReminderActionCandidate(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CreateReminderActionCandidate', r, b);
  }

  @Post('notification-results/register')
  @HttpCode(200)
  registerNotificationResult(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('RegisterNotificationResult', r, b);
  }

  @Post('export-previews/create')
  @HttpCode(200)
  previewExport(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('PreviewExport', r, b);
  }

  @Post('exports/start')
  @HttpCode(200)
  startExport(@Req() r: AuthenticatedRequest, @Body() b: CommandEnvelopeBody) {
    return this.command('StartExport', r, b);
  }

  @Post('exports/cancel')
  @HttpCode(200)
  cancelExport(@Req() r: AuthenticatedRequest, @Body() b: CommandEnvelopeBody) {
    return this.command('CancelExport', r, b);
  }

  @Post('exports/retry')
  @HttpCode(200)
  retryExport(@Req() r: AuthenticatedRequest, @Body() b: CommandEnvelopeBody) {
    return this.command('RetryExport', r, b);
  }

  @Post('exports/download-result')
  @HttpCode(200)
  downloadExportResult(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('DownloadExportResult', r, b);
  }

  @Post('indexes/rebuild')
  @HttpCode(200)
  rebuildIndex(@Req() r: AuthenticatedRequest, @Body() b: CommandEnvelopeBody) {
    return this.command('RebuildIndex', r, b);
  }

  @Post('context-snapshots/refresh')
  @HttpCode(200)
  refreshContextSnapshot(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('RefreshContextSnapshot', r, b);
  }

  @Post('facts/mark-incorrect')
  @HttpCode(200)
  markFactIncorrect(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('MarkFactIncorrect', r, b);
  }

  @Post('object-change-candidates/archive')
  @HttpCode(200)
  createArchiveCandidate(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CreateArchiveObjectCandidate', r, b);
  }

  @Post('object-change-candidates/soft-delete')
  @HttpCode(200)
  createSoftDeleteCandidate(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CreateSoftDeleteObjectCandidate', r, b);
  }

  @Post('object-change-candidates/restore')
  @HttpCode(200)
  createRestoreCandidate(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CreateRestoreObjectCandidate', r, b);
  }

  @Post('object-change-candidates/permanently-delete')
  @HttpCode(200)
  createPermanentDeleteCandidate(
    @Req() r: AuthenticatedRequest,
    @Body() b: CommandEnvelopeBody,
  ) {
    return this.command('CreatePermanentDeleteObjectCandidate', r, b);
  }
}
