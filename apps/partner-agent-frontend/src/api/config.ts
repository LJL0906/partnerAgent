export const apiConfig = {
  serverUrl: process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:3000',
  submitTextPath:
    process.env.EXPO_PUBLIC_SUBMIT_TEXT_PATH ?? '/api/v1/commands/submit-text-input',
  cancelTaskPath: process.env.EXPO_PUBLIC_CANCEL_TASK_PATH ?? '/api/v1/commands/cancel-task',
} as const;
