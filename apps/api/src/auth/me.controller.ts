import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { requirePrincipal, type ApiRequest } from '../common/request.js';
import { AuthService } from './auth.service.js';

@Controller('api/v1/me')
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  current(@Req() request: ApiRequest) {
    return this.auth.currentUser(requirePrincipal(request).userId);
  }

  @Get('tenants')
  async tenants(
    @Req() request: ApiRequest,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.auth.listTenants(requirePrincipal(request).userId, cursor, pageSize);
  }
}
