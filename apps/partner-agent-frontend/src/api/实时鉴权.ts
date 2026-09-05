import type { Socket } from 'socket.io-client';
import { reportUnauthorized, requireAccessToken } from './access-token';

/** Refresh credentials before each handshake; never reconnect a locally closed stream. */
export function configureStreamAuthentication(socket: Socket, initialToken: string, isClosed: () => boolean, onFailure: () => void) {
  let currentToken = initialToken;
  socket.auth = (callback) => {
    void requireAccessToken().then((token) => {
      if (!isClosed()) { currentToken = token; callback({ token }); }
    }).catch(() => { if (!isClosed()) callback({ token: '' }); });
  };
  return {
    disconnected(reason?: string) {
      if (isClosed() || reason !== 'io server disconnect') return;
      void requireAccessToken().then((token) => {
        if (isClosed()) return;
        if (token !== currentToken) socket.connect();
        else void reportUnauthorized(token);
      }).catch(() => { if (!isClosed()) onFailure(); });
    },
    rejected() { void reportUnauthorized(currentToken); },
  };
}
