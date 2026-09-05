export interface SessionReferenceStorage {
  get(scope: string): Promise<string | undefined>;
  set(scope: string, id: string): Promise<void>;
  remove(scope: string): Promise<void>;
}
const references = new Map<string, string>();
export const sessionReferenceStorage: SessionReferenceStorage = {
  get: async (scope) => references.get(scope),
  set: async (scope, id) => { references.set(scope, id); },
  remove: async (scope) => { references.delete(scope); },
};
