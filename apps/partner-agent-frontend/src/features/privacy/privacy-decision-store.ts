import type { CommandResult } from '@partner-agent/contracts';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { ApiClientError } from '../../api/api-error';
import { createOperationId } from '../../api/command-envelope';
import {
  submitPrivacyDecision,
  type PrivacyDecision,
  type SubmitPrivacyDecisionParams,
} from '../../api/privacy-api';

export type PrivacySubmissionPhase =
  | 'idle'
  | 'submitting'
  | 'submitted'
  | 'expired'
  | 'conflict'
  | 'error';

export interface SubmitPrivacyDecisionInput {
  egressId: string;
  decision: PrivacyDecision;
  expiresAt?: string;
  signal?: AbortSignal;
  reconcile: () => Promise<void>;
}

export interface PrivacyDecisionState {
  phase: PrivacySubmissionPhase;
  errorMessage?: string;
  canRefresh: boolean;
  submit: (input: SubmitPrivacyDecisionInput) => Promise<boolean>;
  refresh: (reconcile: () => Promise<void>) => Promise<boolean>;
  reset: () => void;
}

export interface PrivacyDecisionDependencies {
  submitDecision?: (params: SubmitPrivacyDecisionParams) => Promise<CommandResult>;
  createOperationId?: () => string;
  now?: () => number;
}

interface SafeSubmissionError {
  phase: Extract<PrivacySubmissionPhase, 'expired' | 'conflict' | 'error'>;
  errorMessage: string;
  canRefresh: boolean;
}

const INITIAL_STATE = {
  phase: 'idle',
  errorMessage: undefined,
  canRefresh: false,
} as const;

export function createPrivacyDecisionStore(
  dependencies: PrivacyDecisionDependencies = {},
): UseBoundStore<StoreApi<PrivacyDecisionState>> {
  const submitDecision = dependencies.submitDecision ?? submitPrivacyDecision;
  const makeOperationId = dependencies.createOperationId ?? createOperationId;
  const now = dependencies.now ?? Date.now;
  let retryKey: string | undefined;
  let retryOperationId: string | undefined;
  let generation = 0;

  return create<PrivacyDecisionState>((set, get) => ({
    ...INITIAL_STATE,

    submit: async (input) => {
      if (get().phase === 'submitting') return false;
      if (isExpired(input.expiresAt, now())) {
        set({
          phase: 'expired',
          errorMessage: '本次隐私检查已过期，请刷新任务状态。',
          canRefresh: true,
        });
        return false;
      }

      const nextRetryKey = `${input.egressId}:${input.decision}`;
      if (retryKey !== nextRetryKey || !retryOperationId) {
        retryKey = nextRetryKey;
        retryOperationId = makeOperationId();
      }

      const submissionGeneration = generation;
      set({ phase: 'submitting', errorMessage: undefined, canRefresh: false });
      try {
        const result = await submitDecision({
          egressId: input.egressId,
          decision: input.decision,
          operationId: retryOperationId,
          signal: input.signal,
        });
        if (submissionGeneration !== generation) return false;
        if (result.status === 'rejected') {
          set({
            phase: 'error',
            errorMessage: '隐私决定未被接受，请刷新状态后重试。',
            canRefresh: true,
          });
          return false;
        }

        const reconciled = await reconcileSafely(
          input.reconcile,
          set,
          () => submissionGeneration === generation,
        );
        if (!reconciled) return false;

        retryKey = undefined;
        retryOperationId = undefined;
        set({ phase: 'submitted', errorMessage: undefined, canRefresh: false });
        return true;
      } catch (error) {
        if (submissionGeneration !== generation) return false;
        set(toSafeSubmissionError(error));
        return false;
      }
    },

    refresh: async (reconcile) => {
      if (get().phase === 'submitting') return false;
      const refreshGeneration = generation;
      set({ phase: 'submitting', errorMessage: undefined, canRefresh: false });
      const reconciled = await reconcileSafely(
        reconcile,
        set,
        () => refreshGeneration === generation,
      );
      if (!reconciled) return false;
      set(INITIAL_STATE);
      return true;
    },

    reset: () => {
      generation += 1;
      retryKey = undefined;
      retryOperationId = undefined;
      set(INITIAL_STATE);
    },
  }));
}

export const usePrivacyDecisionStore = createPrivacyDecisionStore();

async function reconcileSafely(
  reconcile: () => Promise<void>,
  set: StoreApi<PrivacyDecisionState>['setState'],
  isCurrent: () => boolean,
): Promise<boolean> {
  try {
    await reconcile();
    return isCurrent();
  } catch {
    if (!isCurrent()) return false;
    set({
      phase: 'error',
      errorMessage: '决定已提交，但状态刷新失败，请重试刷新。',
      canRefresh: true,
    });
    return false;
  }
}

function isExpired(expiresAt: string | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

function toSafeSubmissionError(error: unknown): SafeSubmissionError {
  if (error instanceof ApiClientError) {
    if (error.status === 403 && error.body?.code === 'EGRESS_001') {
      return {
        phase: 'expired',
        errorMessage: '本次隐私检查已过期，请刷新任务状态。',
        canRefresh: true,
      };
    }
    if (error.status === 409) {
      return {
        phase: 'conflict',
        errorMessage: '任务状态已变化，请刷新后再决定。',
        canRefresh: true,
      };
    }
    if (error.status === 401 || error.body?.code === 'AUTH_001') {
      return {
        phase: 'error',
        errorMessage: '登录状态已失效，请重新登录。',
        canRefresh: false,
      };
    }
    if (error.status === 0) {
      return {
        phase: 'error',
        errorMessage: '暂时无法连接服务，请检查网络后重试。',
        canRefresh: true,
      };
    }
  }

  return {
    phase: 'error',
    errorMessage: '提交失败，请刷新状态后重试。',
    canRefresh: true,
  };
}
