import { AccountStore } from '../src/auth/账户存储.js';
import { accountContract } from './账户契约.js';
accountContract('username/password accounts (memory)', async () => ({
  store: new AccountStore(),
}));
