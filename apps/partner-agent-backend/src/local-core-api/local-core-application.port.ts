import type {
  LocalCoreCommandRequest,
  LocalCoreRequest,
} from './local-core-api.types.js';

export abstract class LocalCoreApplicationPort {
  abstract executeCommand(
    command: string,
    request: LocalCoreCommandRequest,
  ): Promise<unknown>;

  abstract executeQuery(
    query: string,
    request: LocalCoreRequest,
  ): Promise<unknown>;
}
