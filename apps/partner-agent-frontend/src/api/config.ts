export const apiConfig = {
  serverUrl: process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:3000',
  submitTextPath: '/api/v1/inputs/text',
  cancelTaskPath: '/api/v1/tasks/cancel',
  taskPath: '/api/v1/tasks',
  chatSessionPath: '/api/v1/chat-sessions',
  streamNamespace: '/ws/v1',
} as const;
