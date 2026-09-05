import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HttpAuthGuard } from './http-auth.guard.js';
import { LocalCoreApplicationPort } from './local-core-application.port.js';
import type { AuthenticatedRequest } from './local-core-api.types.js';

type Input = Record<string, unknown>;

@Controller('api/v1')
@UseGuards(HttpAuthGuard)
export class LocalCoreQueryController {
  constructor(private readonly application: LocalCoreApplicationPort) {}

  private query(
    name: string,
    request: AuthenticatedRequest,
    input: Input = {},
  ) {
    const {
      user_id: _ignoredUserId,
      userId: _ignoredCamelUserId,
      ...trustedInput
    } = input;
    return this.application.executeQuery(name, {
      userId: request.userId,
      input: trustedInput,
    });
  }

  @Get('chat-sessions')
  listChatSessions(@Req() r: AuthenticatedRequest) {
    return this.query('ListChatSessions', r);
  }

  @Get('chat-sessions/:sessionId')
  getChatSession(
    @Req() r: AuthenticatedRequest,
    @Param('sessionId') id: string,
  ) {
    return this.query('GetChatSession', r, { session_id: id });
  }

  @Get('original-records/:recordId')
  getOriginalRecord(
    @Req() r: AuthenticatedRequest,
    @Param('recordId') id: string,
  ) {
    return this.query('GetOriginalRecord', r, { record_id: id });
  }

  @Get('attachments/:attachmentId/status')
  getAttachmentStatus(
    @Req() r: AuthenticatedRequest,
    @Param('attachmentId') id: string,
  ) {
    return this.query('GetAttachmentStatus', r, { attachment_id: id });
  }

  @Get('analysis-runs/:analysisRunId')
  getAnalysisRun(
    @Req() r: AuthenticatedRequest,
    @Param('analysisRunId') id: string,
  ) {
    return this.query('GetAnalysisRun', r, { analysis_run_id: id });
  }

  @Get('tasks/:taskId')
  getTaskStatus(@Req() r: AuthenticatedRequest, @Param('taskId') id: string) {
    return this.query('GetTaskStatus', r, { task_id: id });
  }

  @Get('core/health')
  getCoreHealth(@Req() r: AuthenticatedRequest) {
    return this.query('GetCoreHealth', r);
  }

  @Get('confirmation-batches')
  listPendingConfirmationBatches(
    @Req() r: AuthenticatedRequest,
    @Query() q: Input,
  ) {
    return this.query('ListPendingConfirmationBatches', r, q);
  }

  @Get('confirmation-batches/:batchId')
  getConfirmationBatch(
    @Req() r: AuthenticatedRequest,
    @Param('batchId') id: string,
  ) {
    return this.query('GetConfirmationBatch', r, { batch_id: id });
  }

  @Get('candidates/:candidateId')
  getCandidateDetail(
    @Req() r: AuthenticatedRequest,
    @Param('candidateId') id: string,
  ) {
    return this.query('GetCandidateDetail', r, { candidate_id: id });
  }

  @Get('confirmation-history')
  getConfirmationHistory(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('GetConfirmationHistory', r, q);
  }

  @Get('objects/:kind/:objectId/undo-eligibility')
  getUndoEligibility(
    @Req() r: AuthenticatedRequest,
    @Param('kind') kind: string,
    @Param('objectId') id: string,
  ) {
    return this.query('GetUndoEligibility', r, {
      object_kind: kind,
      object_id: id,
    });
  }

  @Get('goals')
  listGoals(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('ListGoals', r, q);
  }

  @Get('goals/:goalId')
  getGoal(@Req() r: AuthenticatedRequest, @Param('goalId') id: string) {
    return this.query('GetGoal', r, { goal_id: id });
  }

  @Get('actions')
  listActions(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('ListActions', r, q);
  }

  @Get('actions/:actionId')
  getAction(@Req() r: AuthenticatedRequest, @Param('actionId') id: string) {
    return this.query('GetAction', r, { action_id: id });
  }

  @Get('facts')
  listFacts(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('ListFacts', r, q);
  }

  @Get('facts/:factId')
  getFact(@Req() r: AuthenticatedRequest, @Param('factId') id: string) {
    return this.query('GetFact', r, { fact_id: id });
  }

  @Get('memories')
  listMemories(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('ListMemories', r, q);
  }

  @Get('memories/:memoryId')
  getMemory(@Req() r: AuthenticatedRequest, @Param('memoryId') id: string) {
    return this.query('GetMemory', r, { memory_id: id });
  }

  @Get('decisions')
  listDecisions(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('ListDecisions', r, q);
  }

  @Get('decisions/:decisionId')
  getDecision(@Req() r: AuthenticatedRequest, @Param('decisionId') id: string) {
    return this.query('GetDecision', r, { decision_id: id });
  }

  @Get('context-snapshot')
  getContextSnapshot(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('GetContextSnapshot', r, q);
  }

  @Get('objects/:kind/:objectId/history')
  getChangeHistory(
    @Req() r: AuthenticatedRequest,
    @Param('kind') kind: string,
    @Param('objectId') id: string,
  ) {
    return this.query('GetChangeHistory', r, {
      object_kind: kind,
      object_id: id,
    });
  }

  @Post('relevant-context/search')
  searchRelevantContext(@Req() r: AuthenticatedRequest, @Body() body: Input) {
    return this.query('SearchRelevantContext', r, body);
  }

  @Get('suggestions/:suggestionId/evidence')
  getSuggestionEvidence(
    @Req() r: AuthenticatedRequest,
    @Param('suggestionId') id: string,
  ) {
    return this.query('GetSuggestionEvidence', r, { suggestion_id: id });
  }

  @Get('indexes/health')
  getIndexHealth(@Req() r: AuthenticatedRequest) {
    return this.query('GetIndexHealth', r);
  }

  @Get('indexes/rebuild-status')
  getIndexRebuildStatus(@Req() r: AuthenticatedRequest) {
    return this.query('GetIndexRebuildStatus', r);
  }

  @Get('summaries/daily')
  getDailySummary(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('GetDailySummary', r, q);
  }

  @Get('reviews/weekly')
  getWeeklyReview(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('GetWeeklyReview', r, q);
  }

  @Get('reminders')
  listReminders(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('ListReminders', r, q);
  }

  @Get('reminder-instances/:reminderInstanceId')
  getReminderInstance(
    @Req() r: AuthenticatedRequest,
    @Param('reminderInstanceId') id: string,
  ) {
    return this.query('GetReminderInstance', r, { reminder_instance_id: id });
  }

  @Get('reminder-candidates')
  listPendingReminderCandidates(
    @Req() r: AuthenticatedRequest,
    @Query() q: Input,
  ) {
    return this.query('ListPendingReminderCandidates', r, q);
  }

  @Get('model-configs')
  listModelConfigs(@Req() r: AuthenticatedRequest) {
    return this.query('ListModelConfigs', r);
  }

  @Get('model-runtime/status')
  getModelRuntimeStatus(@Req() r: AuthenticatedRequest) {
    return this.query('GetModelRuntimeStatus', r);
  }

  @Get('privacy-policy/status')
  getPrivacyPolicyStatus(@Req() r: AuthenticatedRequest) {
    return this.query('GetPrivacyPolicyStatus', r);
  }

  @Get('export-preview')
  getExportPreview(@Req() r: AuthenticatedRequest, @Query() q: Input) {
    return this.query('GetExportPreview', r, q);
  }

  @Get('exports/:exportTaskId')
  getExportTask(
    @Req() r: AuthenticatedRequest,
    @Param('exportTaskId') id: string,
  ) {
    return this.query('GetExportTask', r, { export_task_id: id });
  }
}
