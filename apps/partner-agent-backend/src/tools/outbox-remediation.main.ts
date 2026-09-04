import { runOutboxRemediation } from './outbox-remediation.cli.js';
import { OutboxRemediationError } from './outbox-remediation.service.js';

runOutboxRemediation(process.argv.slice(2)).then(
  (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
  (error: unknown) => {
    const message =
      error instanceof OutboxRemediationError
        ? error.message
        : 'Outbox 处置失败（底层错误详情已隐藏）';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  },
);
