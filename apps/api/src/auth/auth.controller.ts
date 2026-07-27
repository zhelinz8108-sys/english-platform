import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { signCsrfToken } from '../common/domain.js';
import { parseBody } from '../common/problem.js';
import { requirePrincipal, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { AllowBeforePasswordChange, Public, RequiresCsrf } from './guards.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(128),
});
const passwordSchema = z
  .object({
    currentPassword: z.string().min(8).max(128),
    newPassword: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/, '必须包含小写字母')
      .regex(/[A-Z]/, '必须包含大写字母')
      .regex(/[0-9]/, '必须包含数字')
      .regex(/[^A-Za-z0-9]/, '必须包含符号'),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: '新密码不能与当前密码相同',
  });

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get('csrf')
  @Public()
  csrf(@Res({ passthrough: true }) response: Response): { token: string; expiresAt: string } {
    const csrf = signCsrfToken(this.config.csrfSecret);
    response.cookie('csrf_token', csrf.token, {
      ...this.baseCookie(),
      httpOnly: false,
      sameSite: 'lax',
      expires: csrf.expiresAt,
    });
    return { token: csrf.token, expiresAt: csrf.expiresAt.toISOString() };
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @RequiresCsrf()
  async login(
    @Body() rawBody: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReturnType<AuthController['sessionBody']>> {
    const body = parseBody(loginSchema, rawBody);
    const issued = await this.auth.login(
      body.identifier,
      body.password,
      request.ip ?? '',
      request.header('user-agent') ?? '',
    );
    this.setSessionCookies(response, issued);
    return this.sessionBody(issued);
  }

  @Post('password')
  @HttpCode(204)
  @AllowBeforePasswordChange()
  @RequiresCsrf()
  async changePassword(@Body() rawBody: unknown, @Req() request: ApiRequest): Promise<void> {
    const body = parseBody(passwordSchema, rawBody);
    const principal = requirePrincipal(request);
    await this.auth.changePassword(
      principal.userId,
      principal.sessionId,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @RequiresCsrf()
  async refresh(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReturnType<AuthController['sessionBody']>> {
    const issued = await this.auth.refresh(
      request.cookies?.refresh_token as string | undefined,
      request.ip ?? '',
      request.header('user-agent') ?? '',
    );
    this.setSessionCookies(response, issued);
    return this.sessionBody(issued);
  }

  @Delete('session')
  @HttpCode(204)
  @AllowBeforePasswordChange()
  @RequiresCsrf()
  async logout(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const principal = requirePrincipal(request);
    await this.auth.revokeFamily(principal.sessionId, principal.userId);
    response.clearCookie('access_token', { ...this.baseCookie(), httpOnly: true, sameSite: 'lax' });
    response.clearCookie('refresh_token', {
      ...this.baseCookie(),
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }

  private setSessionCookies(response: Response, issued: IssuedSession): void {
    response.cookie('access_token', issued.accessToken, {
      ...this.baseCookie(),
      httpOnly: true,
      sameSite: 'lax',
      expires: issued.accessExpiresAt,
    });
    response.cookie('refresh_token', issued.refreshToken, {
      ...this.baseCookie(),
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires: issued.refreshExpiresAt,
    });
  }

  private baseCookie(): Pick<CookieOptions, 'secure' | 'domain'> {
    return {
      secure: this.config.values.COOKIE_SECURE,
      ...(this.config.values.COOKIE_DOMAIN ? { domain: this.config.values.COOKIE_DOMAIN } : {}),
    };
  }

  private sessionBody(issued: IssuedSession): {
    user: IssuedSession['user'];
    accessExpiresAt: string;
    refreshExpiresAt: string;
  } {
    return {
      user: issued.user,
      accessExpiresAt: issued.accessExpiresAt.toISOString(),
      refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    };
  }
}
