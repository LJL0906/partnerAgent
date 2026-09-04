export function chatTaskEventErrorMessage(data: unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message;
  }
  return '模型调用失败';
}

export function chatTaskEventErrorCode(data: unknown): string {
  return data &&
    typeof data === 'object' &&
    'result' in data &&
    data.result === 'blocked'
    ? 'EGRESS_001'
    : 'MODEL_002';
}

export function thrownChatTaskErrorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EGRESS_001'
    ? 'EGRESS_001'
    : 'INTERNAL_000';
}

export function safeChatTaskErrorMessage(message: string): string {
  return message
    .replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(password|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}
