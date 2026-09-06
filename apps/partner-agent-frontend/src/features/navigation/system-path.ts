const SAFE_FALLBACK_PATH = '/auth';
const MAX_SYSTEM_PATH_LENGTH = 2048;
const MAX_PERCENT_ESCAPES = 64;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/i;

interface WebLocationParts {
  pathname: string;
  search: string;
  hash: string;
}

export function sanitizeSystemPath(path: string): string {
  if (path.length > MAX_SYSTEM_PATH_LENGTH || MALFORMED_PERCENT_ESCAPE.test(path)) {
    return SAFE_FALLBACK_PATH;
  }

  let percentEscapes = 0;
  for (const character of path) {
    if (character !== '%') continue;
    percentEscapes += 1;
    if (percentEscapes > MAX_PERCENT_ESCAPES) return SAFE_FALLBACK_PATH;
  }

  return path;
}

export function prepareWebRouterBootstrap(
  location: WebLocationParts,
  replace: (path: string) => void,
): boolean {
  const initialPath = `${location.pathname}${location.search}${location.hash}`;
  const safePath = sanitizeSystemPath(initialPath);
  if (safePath === initialPath) return true;

  replace(safePath);
  return false;
}
