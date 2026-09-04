import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import {
  getAllowedOrigins,
  SecureIoAdapter,
} from './websocket/secure-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter());
  const configService = app.get(ConfigService);
  const allowedOrigins = getAllowedOrigins(configService);
  app.enableCors({
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
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
