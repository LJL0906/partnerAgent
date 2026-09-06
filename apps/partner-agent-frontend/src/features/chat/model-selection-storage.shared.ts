import type { ReasoningLevel } from '@partner-agent/contracts';

export interface ModelSelectionPreference {
  modelConfigId: string;
  reasoningLevel: ReasoningLevel;
}

export interface ModelSelectionPreferenceStorage {
  get(ownerId: string): Promise<ModelSelectionPreference | undefined>;
  set(ownerId: string, preference: ModelSelectionPreference): Promise<void>;
}

const reasoningLevels = new Set<ReasoningLevel>([
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]);

export function parseModelSelectionPreference(
  value: string | null | undefined,
): ModelSelectionPreference | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed.modelConfigId === 'string'
      && parsed.modelConfigId.trim().length > 0
      && reasoningLevels.has(parsed.reasoningLevel as ReasoningLevel)
      ? {
          modelConfigId: parsed.modelConfigId,
          reasoningLevel: parsed.reasoningLevel as ReasoningLevel,
        }
      : undefined;
  } catch {
    return undefined;
  }
}
