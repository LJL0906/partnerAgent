import { useMemo, useSyncExternalStore } from 'react';

import { createToolActionState } from './chat-tool-action-state';
import type { ChatToolControls } from './chat-tool-controls';

/** A new session revision gets a separate controller; late ACKs cannot affect it. */
export function useChatToolActions(controls: ChatToolControls, sessionRevision: number) {
  const { controller } = useMemo(() => ({
    sessionRevision, controller: createToolActionState(controls),
  }), [controls, sessionRevision]);
  const feedback = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { feedback, run: controller.run };
}
