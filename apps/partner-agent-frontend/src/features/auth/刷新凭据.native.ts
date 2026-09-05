import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { apiConfig } from '@/api/config';

async function key(): Promise<string> {
  const scope = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, apiConfig.serverUrl.replace(/\/$/, ''));
  return `partner-agent.refresh.${scope}`;
}
export const refreshStorage = {
  async get(): Promise<string | undefined> { return (await SecureStore.getItemAsync(await key())) ?? undefined; },
  async set(token: string): Promise<void> { await SecureStore.setItemAsync(await key(), token); },
  async remove(): Promise<void> { await SecureStore.deleteItemAsync(await key()); },
};
