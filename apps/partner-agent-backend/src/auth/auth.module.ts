import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { WsAuthGuard } from './ws-auth.guard.js';

@Global()
@Module({
  providers: [AuthService, WsAuthGuard],
  exports: [AuthService, WsAuthGuard],
})
export class AuthModule {}
