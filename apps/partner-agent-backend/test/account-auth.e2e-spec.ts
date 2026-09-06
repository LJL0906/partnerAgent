import { AccountStore } from '../src/auth/account-store.js';
import { accountContract } from './account-contract.js';
accountContract('username/password accounts (memory)', async () => ({
  store: new AccountStore(),
}));
