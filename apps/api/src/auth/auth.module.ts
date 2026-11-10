import { Module } from '@nestjs/common';
import { UsersRepository } from '../users/users.repository.js';
import './auth-types.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CredentialsService } from './credentials.service.js';
import { DrizzleSessionStore } from './drizzle-session.store.js';
import { SessionAuth } from './session-auth.provider.js';

@Module({
  controllers: [AuthController],
  providers: [DrizzleSessionStore, SessionAuth, CredentialsService, AuthService, UsersRepository],
  exports: [CredentialsService, UsersRepository],
})
export class AuthModule {}
