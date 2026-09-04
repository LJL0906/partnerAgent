import type {
  BusinessObjectAction,
  BusinessObjectKind,
  CommandResult,
  SubmitConfirmationBatchPayload,
  SubmitConfirmationBatchResult,
} from '@partner-agent/contracts';

export type JsonObject = Record<string, unknown>;

export interface BatchRow {
  id: string;
  user_id: string;
  batch_status: string;
  risk_level: 'normal' | 'high';
  expires_at: Date | string;
  version: string;
}

export interface CandidateRow {
  id: string;
  batch_id: string;
  kind: BusinessObjectKind;
  action: BusinessObjectAction;
  candidate_status: string;
  risk: 'normal' | 'high';
  payload: JsonObject;
  edited_payload: JsonObject | null;
  target_object_id: string | null;
  expected_version: string | null;
  source_refs: unknown;
  expires_at: Date | string;
  version: string;
  editable_fields: string[];
}

export interface BusinessRow {
  id: string;
  user_id: string;
  kind: BusinessObjectKind;
  version: string;
  lifecycle_status: string;
  created_by_batch_id: string;
  last_confirmation_batch_id: string;
  archived_at: Date | string | null;
  deleted_at: Date | string | null;
  purged_at: Date | string | null;
}

export interface ObjectSnapshot {
  object: BusinessRow;
  domain: JsonObject | null;
}

export interface VersionRow {
  object_id: string;
  object_version: string;
  change_type: string;
  snapshot: { before: ObjectSnapshot | null; after: ObjectSnapshot };
}

export interface ChangedObject {
  id: string;
  kind: BusinessObjectKind;
  version: string;
}

export type ParsedPayload = SubmitConfirmationBatchPayload;
export type StoredCommandResult = CommandResult<SubmitConfirmationBatchResult>;
