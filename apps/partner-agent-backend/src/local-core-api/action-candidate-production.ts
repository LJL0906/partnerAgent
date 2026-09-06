import { randomUUID } from 'node:crypto';
import type { ChatPreviewV1 } from '@partner-agent/contracts';
import type { EntityManager } from 'typeorm';
import type { ChatTaskEntity } from '../database/entities/chat-task.entity.js';

export interface PersistedActionCandidateBatch {
  analysisRunId: string;
  structuredAnalysisId: string;
  batchId: string;
  candidateIds: string[];
  candidateCount: number;
  riskLevel: 'normal';
  safeSummary: string;
}

export type ActionPreviewDisposition = 'auto_apply' | 'needs_choice';

export function actionPreviewDisposition(
  previews: readonly ChatPreviewV1[],
): ActionPreviewDisposition {
  if (previews.length !== 1) return 'needs_choice';
  const { content } = previews[0];
  return content.confidence >= 0.85 && !content.uncertainty?.trim()
    ? 'auto_apply'
    : 'needs_choice';
}

/**
 * Promotes validated chat previews into formal, unapplied Action candidates.
 * The caller owns the surrounding fenced transaction.
 */
export async function persistActionCandidates(
  manager: EntityManager,
  task: ChatTaskEntity,
  previews: ChatPreviewV1[],
  now: Date,
): Promise<PersistedActionCandidateBatch | undefined> {
  if (previews.length === 0) return undefined;

  const [record] = (await manager.query(
    `select request_fingerprint from original_records
     where owner_id=$1 and id=$2`,
    [task.ownerId, task.originalRecordId],
  )) as Array<{ request_fingerprint: string }>;
  if (!record) throw new Error('AUTH_002');

  const analysisRunId = randomUUID();
  const structuredAnalysisId = randomUUID();
  const batchId = randomUUID();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  const candidateIds = previews.map(() => randomUUID());
  const structuredResult = {
    schema_version: 1,
    analysis_type: 'action',
    candidates: previews.map((preview) => ({
      proposal_id: preview.preview_id,
      title: preview.content.title,
      ...(preview.content.description
        ? { description: preview.content.description }
        : {}),
      execution_status: 'todo',
      ...(preview.content.planned_at
        ? { planned_at: preview.content.planned_at }
        : {}),
      ...(preview.content.deadline_at
        ? { deadline_at: preview.content.deadline_at }
        : {}),
      ...(preview.content.timezone
        ? { timezone: preview.content.timezone }
        : {}),
      ...(preview.content.priority
        ? { priority: preview.content.priority }
        : {}),
      confidence: preview.content.confidence,
      ...(preview.content.uncertainty
        ? { uncertainty: preview.content.uncertainty }
        : {}),
      source: { source_ref: preview.source_refs[0] },
    })),
  };

  await manager.query(
    `insert into analysis_runs
       (id,owner_id,original_record_id,chat_task_id,analysis_type,status,
        request_fingerprint,started_at,completed_at,version,created_at,updated_at)
     values ($1,$2,$3,$4,'action','completed',$5,$6,$6,1,$6,$6)`,
    [
      analysisRunId,
      task.ownerId,
      task.originalRecordId,
      task.id,
      record.request_fingerprint,
      now,
    ],
  );
  await manager.query(
    `insert into structured_analyses
       (id,owner_id,analysis_run_id,schema_version,status,result_json,
        validation_errors,created_at)
     values ($1,$2,$3,1,'valid',$4::jsonb,'[]'::jsonb,$5)`,
    [
      structuredAnalysisId,
      task.ownerId,
      analysisRunId,
      JSON.stringify(structuredResult),
      now,
    ],
  );
  await manager.query(
    `insert into confirmation_batches
       (id,user_id,source_record_id,source_analysis_id,batch_status,risk_level,
        expires_at,version,created_at,updated_at)
     values ($1,$2,$3,$4,'pending','normal',$5,1,$6,$6)`,
    [
      batchId,
      task.ownerId,
      task.originalRecordId,
      structuredAnalysisId,
      expiresAt,
      now,
    ],
  );

  for (const [index, preview] of previews.entries()) {
    const content = preview.content;
    const payload = {
      title: content.title,
      ...(content.description ? { description: content.description } : {}),
      execution_status: 'todo',
      plan_status: 'normal',
      timeliness_status: content.deadline_at ? 'not_due' : 'no_deadline',
      ...(content.planned_at ? { planned_at: content.planned_at } : {}),
      ...(content.deadline_at ? { deadline_at: content.deadline_at } : {}),
      ...(content.timezone ? { timezone: content.timezone } : {}),
      ...(content.priority ? { priority: content.priority } : {}),
    };
    await manager.query(
      `insert into candidate_items
         (id,batch_id,user_id,kind,action,payload,risk,editable_fields,
          confidence,sensitive_marks,source_refs,expires_at,version,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'{}',$10::jsonb,$11,1,$12,$12)`,
      [
        candidateIds[index],
        batchId,
        task.ownerId,
        'action',
        'create',
        JSON.stringify(payload),
        'normal',
        ['title', 'description', 'planned_at', 'deadline_at', 'timezone', 'priority'],
        content.confidence,
        JSON.stringify(preview.source_refs),
        expiresAt,
        now,
      ],
    );
  }

  return {
    analysisRunId,
    structuredAnalysisId,
    batchId,
    candidateIds,
    candidateCount: candidateIds.length,
    riskLevel: 'normal',
    safeSummary:
      candidateIds.length === 1
        ? `待确认行动：${previews[0].content.title}`.slice(0, 160)
        : `已生成 ${candidateIds.length} 个待确认行动`,
  };
}
