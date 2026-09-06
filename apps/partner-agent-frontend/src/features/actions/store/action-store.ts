import type { SubmitConfirmationBatchPayload } from '@partner-agent/contracts';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { ApiClientError } from '../../../api/api-error';
import { createOperationId } from '../../../api/command-envelope';
import {
  actionApi,
  type ActionApi,
  type ActionDetail,
  type ActionListQuery,
  type ActionSummary,
  type CandidateDetail,
  type ChangeHistoryItem,
  type ConfirmationBatchDetail,
  type ConfirmationHistoryItem,
  type CreateUndoObjectCandidatePayload,
  type PendingConfirmationBatchSummary,
  type UndoEligibility,
} from '../services/action-api';

export type LoadPhase = 'idle' | 'loading' | 'ready' | 'error';
export type MutationPhase = 'idle' | 'submitting' | 'succeeded' | 'conflict' | 'error';

export interface LoadState<T> {
  phase: LoadPhase;
  data?: T;
  errorMessage?: string;
}

export interface MutationState {
  phase: MutationPhase;
  errorMessage?: string;
  canRetry: boolean;
}

export interface ActionState {
  pendingBatches: LoadState<PendingConfirmationBatchSummary[]>;
  batches: Record<string, LoadState<ConfirmationBatchDetail>>;
  candidates: Record<string, LoadState<CandidateDetail>>;
  confirmationHistory: LoadState<ConfirmationHistoryItem[]>;
  actions: LoadState<ActionSummary[]>;
  actionDetails: Record<string, LoadState<ActionDetail>>;
  actionHistory: Record<string, LoadState<ChangeHistoryItem[]>>;
  undoEligibility: Record<string, LoadState<UndoEligibility>>;
  candidateDrafts: Record<string, Record<string, unknown>>;
  confirmationMutation: MutationState;
  undoMutation: MutationState;
  refreshPendingBatches: () => Promise<boolean>;
  refreshFromCandidateHint: () => Promise<boolean>;
  loadBatch: (batchId: string) => Promise<boolean>;
  loadCandidate: (candidateId: string) => Promise<boolean>;
  loadConfirmationHistory: () => Promise<boolean>;
  refreshActions: (query?: ActionListQuery) => Promise<boolean>;
  loadAction: (actionId: string) => Promise<boolean>;
  loadActionHistory: (actionId: string) => Promise<boolean>;
  loadUndoEligibility: (actionId: string) => Promise<boolean>;
  setCandidateDraft: (candidateId: string, draft?: Record<string, unknown>) => void;
  submitConfirmation: (payload: SubmitConfirmationBatchPayload) => Promise<boolean>;
  createUndoCandidate: (eligibility: UndoEligibility) => Promise<string | undefined>;
  reset: () => void;
}

export interface ActionStoreDependencies {
  api?: ActionApi;
  createOperationId?: () => string;
}

const IDLE_LOAD = { phase: 'idle' as const };
const IDLE_MUTATION = { phase: 'idle' as const, canRetry: false };

function initialState() {
  return {
    pendingBatches: IDLE_LOAD,
    batches: {},
    candidates: {},
    confirmationHistory: IDLE_LOAD,
    actions: IDLE_LOAD,
    actionDetails: {},
    actionHistory: {},
    undoEligibility: {},
    candidateDrafts: {},
    confirmationMutation: IDLE_MUTATION,
    undoMutation: IDLE_MUTATION,
  };
}

export function createActionStore(
  dependencies: ActionStoreDependencies = {},
): UseBoundStore<StoreApi<ActionState>> {
  const api = dependencies.api ?? actionApi;
  const makeOperationId = dependencies.createOperationId ?? createOperationId;
  let generation = 0;
  const requestRevisions = new Map<string, number>();
  let confirmationRetry: { key: string; operationId: string } | undefined;
  let undoRetry: { key: string; operationId: string } | undefined;

  const nextRequest = (key: string) => {
    const revision = (requestRevisions.get(key) ?? 0) + 1;
    requestRevisions.set(key, revision);
    return { generation, revision };
  };
  const isCurrent = (key: string, request: { generation: number; revision: number }) =>
    request.generation === generation && requestRevisions.get(key) === request.revision;

  return create<ActionState>((set, get) => {
    const loadPending = async () => {
      const key = 'pending';
      const request = nextRequest(key);
      set((state) => ({ pendingBatches: loading(state.pendingBatches) }));
      try {
        const result = await api.listPendingConfirmationBatches();
        if (!isCurrent(key, request)) return false;
        set({ pendingBatches: ready(result.items) });
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set({ pendingBatches: failed('待确认内容加载失败，请稍后重试。') });
        return false;
      }
    };

    const loadBatch = async (batchId: string) => {
      const key = `batch:${batchId}`;
      const request = nextRequest(key);
      set((state) => ({ batches: { ...state.batches, [batchId]: loading(state.batches[batchId]) } }));
      try {
        const result = await api.getConfirmationBatch(batchId);
        if (!isCurrent(key, request)) return false;
        set((state) => ({ batches: { ...state.batches, [batchId]: ready(result) } }));
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set((state) => ({ batches: { ...state.batches, [batchId]: failed('确认批次加载失败，请稍后重试。') } }));
        return false;
      }
    };

    const loadCandidate = async (candidateId: string) => {
      const key = `candidate:${candidateId}`;
      const request = nextRequest(key);
      set((state) => ({ candidates: { ...state.candidates, [candidateId]: loading(state.candidates[candidateId]) } }));
      try {
        const result = await api.getCandidateDetail(candidateId);
        if (!isCurrent(key, request)) return false;
        set((state) => ({ candidates: { ...state.candidates, [candidateId]: ready(result) } }));
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set((state) => ({ candidates: { ...state.candidates, [candidateId]: failed('候选详情加载失败，请稍后重试。') } }));
        return false;
      }
    };

    const loadConfirmationHistory = async () => {
      const key = 'confirmation-history';
      const request = nextRequest(key);
      set((state) => ({ confirmationHistory: loading(state.confirmationHistory) }));
      try {
        const result = await api.listConfirmationHistory();
        if (!isCurrent(key, request)) return false;
        set({ confirmationHistory: ready(result.items) });
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set({ confirmationHistory: failed('确认历史加载失败，请稍后重试。') });
        return false;
      }
    };

    const refreshActions = async (query: ActionListQuery = {}) => {
      const key = 'actions';
      const request = nextRequest(key);
      set((state) => ({ actions: loading(state.actions) }));
      try {
        const result = await api.listActions(query);
        if (!isCurrent(key, request)) return false;
        set({ actions: ready(result.items) });
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set({ actions: failed('行动列表加载失败，请稍后重试。') });
        return false;
      }
    };

    const loadAction = async (actionId: string) => {
      const key = `action:${actionId}`;
      const request = nextRequest(key);
      set((state) => ({ actionDetails: { ...state.actionDetails, [actionId]: loading(state.actionDetails[actionId]) } }));
      try {
        const result = await api.getAction(actionId);
        if (!isCurrent(key, request)) return false;
        set((state) => ({ actionDetails: { ...state.actionDetails, [actionId]: ready(result) } }));
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set((state) => ({ actionDetails: { ...state.actionDetails, [actionId]: failed('行动详情加载失败，请稍后重试。') } }));
        return false;
      }
    };

    const loadActionHistory = async (actionId: string) => {
      const key = `action-history:${actionId}`;
      const request = nextRequest(key);
      set((state) => ({ actionHistory: { ...state.actionHistory, [actionId]: loading(state.actionHistory[actionId]) } }));
      try {
        const result = await api.getActionHistory(actionId);
        if (!isCurrent(key, request)) return false;
        set((state) => ({ actionHistory: { ...state.actionHistory, [actionId]: ready(result.items) } }));
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set((state) => ({ actionHistory: { ...state.actionHistory, [actionId]: failed('行动历史加载失败，请稍后重试。') } }));
        return false;
      }
    };

    const loadUndoEligibility = async (actionId: string) => {
      const key = `undo:${actionId}`;
      const request = nextRequest(key);
      set((state) => ({ undoEligibility: { ...state.undoEligibility, [actionId]: loading(state.undoEligibility[actionId]) } }));
      try {
        const result = await api.getUndoEligibility(actionId);
        if (!isCurrent(key, request)) return false;
        set((state) => ({ undoEligibility: { ...state.undoEligibility, [actionId]: ready(result) } }));
        return true;
      } catch {
        if (!isCurrent(key, request)) return false;
        set((state) => ({ undoEligibility: { ...state.undoEligibility, [actionId]: failed('撤销资格加载失败，请稍后重试。') } }));
        return false;
      }
    };

    return {
      ...initialState(),
      refreshPendingBatches: loadPending,
      refreshFromCandidateHint: loadPending,
      loadBatch,
      loadCandidate,
      loadConfirmationHistory,
      refreshActions,
      loadAction,
      loadActionHistory,
      loadUndoEligibility,
      setCandidateDraft: (candidateId, draft) => set((state) => {
        const candidateDrafts = { ...state.candidateDrafts };
        if (draft === undefined) delete candidateDrafts[candidateId];
        else candidateDrafts[candidateId] = { ...draft };
        return { candidateDrafts };
      }),
      submitConfirmation: async (payload) => {
        if (get().confirmationMutation.phase === 'submitting') return false;
        const key = JSON.stringify(payload);
        if (!confirmationRetry || confirmationRetry.key !== key) confirmationRetry = { key, operationId: makeOperationId() };
        const submissionGeneration = generation;
        let commandCommitted = false;
        set({ confirmationMutation: { phase: 'submitting', canRetry: false } });
        try {
          const result = await api.submitConfirmationBatch(payload, { operationId: confirmationRetry.operationId });
          if (submissionGeneration !== generation) return false;
          if ((result.status !== 'completed' && result.status !== 'duplicate') || !result.data) {
            set({ confirmationMutation: failedMutation('确认未完成，请刷新后重试。') });
            return false;
          }
          commandCommitted = true;
          const actionIds = result.data.confirmed.filter(({ ref }) => ref.kind === 'action').map(({ ref }) => ref.id);
          const [nextBatch, nextPending, nextActions, ...details] = await Promise.all([
            api.getConfirmationBatch(payload.confirmation_batch_id),
            api.listPendingConfirmationBatches(),
            api.listActions(),
            ...actionIds.map((id) => api.getAction(id)),
          ]);
          if (submissionGeneration !== generation) return false;
          set((state) => {
            const candidateDrafts = { ...state.candidateDrafts };
            for (const item of payload.items) delete candidateDrafts[item.candidate_id];
            const actionDetails = { ...state.actionDetails };
            details.forEach((detail) => { actionDetails[detail.action_ref.id] = ready(detail); });
            return {
              batches: { ...state.batches, [nextBatch.batch_ref.id]: ready(nextBatch) },
              pendingBatches: ready(nextPending.items), actions: ready(nextActions.items),
              actionDetails, candidateDrafts,
              confirmationMutation: { phase: 'succeeded', canRetry: false },
            };
          });
          confirmationRetry = undefined;
          return true;
        } catch (error) {
          if (submissionGeneration !== generation) return false;
          if (error instanceof ApiClientError && error.status === 409) {
            await loadBatch(payload.confirmation_batch_id);
            if (submissionGeneration === generation) set({ confirmationMutation: { phase: 'conflict', errorMessage: '候选已发生变化，已刷新最新内容；你的编辑仍已保留。', canRetry: true } });
            return false;
          }
          set({ confirmationMutation: failedMutation(commandCommitted
            ? '确认已提交，但最新状态读取失败；请刷新，重试仍会复用同一操作。'
            : safeMutationError(error, '确认提交失败，请刷新后重试。')) });
          return false;
        }
      },
      createUndoCandidate: async (eligibility) => {
        if (get().undoMutation.phase === 'submitting' || !eligibility.eligible) return undefined;
        const payload: CreateUndoObjectCandidatePayload = {
          original_confirmation_action_id: eligibility.original_confirmation_action_id,
          original_confirmation_batch_id: eligibility.original_confirmation_batch_id,
          observed_versions: eligibility.undo_scope.observed_versions,
        };
        const key = JSON.stringify(payload);
        if (!undoRetry || undoRetry.key !== key) undoRetry = { key, operationId: makeOperationId() };
        const submissionGeneration = generation;
        let commandCommitted = false;
        set({ undoMutation: { phase: 'submitting', canRetry: false } });
        try {
          const result = await api.createUndoCandidate(payload, { operationId: undoRetry.operationId });
          if (submissionGeneration !== generation) return undefined;
          commandCommitted = true;
          const batchId = result.data.confirmation_batch_ref.id;
          const [nextBatch, nextPending] = await Promise.all([
            api.getConfirmationBatch(batchId), api.listPendingConfirmationBatches(),
          ]);
          if (submissionGeneration !== generation) return undefined;
          set((state) => ({
            batches: { ...state.batches, [batchId]: ready(nextBatch) },
            pendingBatches: ready(nextPending.items),
            undoMutation: { phase: 'succeeded', canRetry: false },
          }));
          undoRetry = undefined;
          return batchId;
        } catch (error) {
          if (submissionGeneration !== generation) return undefined;
          set({ undoMutation: failedMutation(commandCommitted
            ? '撤销候选已提交，但最新状态读取失败；请刷新，重试仍会复用同一操作。'
            : safeMutationError(error, '撤销候选创建失败，请刷新后重试。')) });
          return undefined;
        }
      },
      reset: () => {
        generation += 1;
        requestRevisions.clear();
        confirmationRetry = undefined;
        undoRetry = undefined;
        set(initialState());
      },
    };
  });
}

export const useActionStore = createActionStore();

function loading<T>(current?: LoadState<T>): LoadState<T> {
  return { phase: 'loading', ...(current?.data !== undefined ? { data: current.data } : {}) };
}
function ready<T>(data: T): LoadState<T> { return { phase: 'ready', data }; }
function failed<T>(errorMessage: string): LoadState<T> { return { phase: 'error', errorMessage }; }
function failedMutation(errorMessage: string): MutationState { return { phase: 'error', errorMessage, canRetry: true }; }

function safeMutationError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return '登录状态已失效，请重新登录。';
    if (error.status === 409) return '数据版本已变化，请刷新后重试。';
    if (error.status === 0) return '暂时无法连接服务，请检查网络后重试。';
  }
  return fallback;
}
