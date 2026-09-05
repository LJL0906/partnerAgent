import type { SessionReferenceStorage } from './会话存储';
export const sessionReferenceStorage: SessionReferenceStorage = {
  get: async (scope) => globalThis.localStorage?.getItem(`chat.session.v1.${scope}`) ?? undefined,
  set: async (scope, id) => { globalThis.localStorage?.setItem(`chat.session.v1.${scope}`, id); },
  remove: async (scope) => { globalThis.localStorage?.removeItem(`chat.session.v1.${scope}`); },
};
