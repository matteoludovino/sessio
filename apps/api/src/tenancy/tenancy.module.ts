import { Global, Module } from '@nestjs/common';
import { Tenant } from './tenant.js';

@Global()
@Module({ providers: [Tenant], exports: [Tenant] })
export class TenancyModule {}
