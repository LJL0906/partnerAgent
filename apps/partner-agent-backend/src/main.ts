import { ShutdownSignal } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { HealthStateService } from './health/health-state.service.js';
import { parseServerBinding } from './main-config.js';
import {
  getAllowedOrigins,
  SecureIoAdapter,
} from './websocket/secure-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter());
  const shutdownSignals = [ShutdownSignal.SIGINT, ShutdownSignal.SIGTERM];
  const healthState = app.get(HealthStateService);
  for (const signal of shutdownSignals) {
    process.prependOnceListener(signal, () => healthState.beginDraining());
  }
  app.enableShutdownHooks(shutdownSignals);
  const configService = app.get(ConfigService);
  const allowedOrigins = getAllowedOrigins(configService);
  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(new Error('Origin 不在允许列表中'));
    },
  });
  app.useWebSocketAdapter(
    new SecureIoAdapter(app, app.get(AuthService), configService),
  );
  const binding = parseServerBinding({
    HOST: configService.get<string>('HOST'),
    PORT: configService.get<string>('PORT'),
  });
  await app.listen(binding.port, binding.host);
}
await bootstrap();
