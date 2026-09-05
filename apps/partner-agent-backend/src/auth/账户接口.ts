import {
  Catch,
  HttpException,
  UseFilters,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { AccountService, type AccountTokens } from './账户服务.js';

const COOKIE = 'partner_agent_refresh';

@Catch()
class AccountExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const message = error instanceof HttpException ? error.message : '账户服务暂时不可用，请稍后重试。';
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ statusCode: status, message });
  }
}

@Controller('api/v1/auth')
@UseFilters(new AccountExceptionFilter())
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.checkOrigin(req);
    return this.respond(
      await this.accounts.register(body, req.socket.remoteAddress ?? 'unknown'),
      req,
      res,
    );
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.checkOrigin(req);
    return this.respond(
      await this.accounts.login(body, req.socket.remoteAddress ?? 'unknown'),
      req,
      res,
    );
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.checkOrigin(req);
    return this.respond(
      await this.accounts.refresh(
        this.readRefresh(body, req),
        req.socket.remoteAddress ?? 'unknown',
      ),
      req,
      res,
    );
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.checkOrigin(req);
    await this.accounts.logout(this.readRefresh(body, req));
    if (this.isWeb(req)) this.setCookie(res, '', new Date(0));
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() req: Request) {
    try {
      const authorization = req.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) throw new Error();
      return await this.accounts.me(
        await this.auth.verifyToken(authorization.slice(7)),
      );
    } catch {
      throw new UnauthorizedException('登录已失效，请重新登录。');
    }
  }

  private isWeb(req: Request): boolean {
    return req.headers['x-auth-client'] === 'web';
  }
  private checkOrigin(req: Request): void {
    const origin = req.headers.origin;
    const allowed = (
      this.config.get<string>('CORS_ALLOWED_ORIGINS') ??
      'http://localhost:3000,http://localhost:5173'
    )
      .split(',')
      .map((s) => s.trim());
    if ((origin && !allowed.includes(origin)) || (this.isWeb(req) && !origin))
      throw new UnauthorizedException('请求来源不受信任。');
    // Cookie-bearing requests always need an allowed Origin, regardless of client header.
    if (req.headers.cookie?.includes(`${COOKIE}=`) && !origin)
      throw new UnauthorizedException('请求来源不受信任。');
  }
  private readRefresh(body: unknown, req: Request): unknown {
    if (this.isWeb(req)) {
      const raw = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${COOKIE}=`));
      return raw?.slice(COOKIE.length + 1);
    }
    return (body as { refresh_token?: unknown } | null)?.refresh_token;
  }
  private setCookie(res: Response, value: string, expires: Date): void {
    res.cookie(COOKIE, value, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires,
    });
  }
  private respond(tokens: AccountTokens, req: Request, res: Response) {
    if (!this.isWeb(req)) return tokens;
    this.setCookie(
      res,
      tokens.refresh_token,
      new Date(tokens.refresh_expires_at),
    );
    const { refresh_token: _refresh, ...publicTokens } = tokens;
    return publicTokens;
  }
}
