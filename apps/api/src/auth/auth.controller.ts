import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { CurrentUser, Public, SignInService } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { type SignInDto, signInSchema, type SignUpDto, signUpSchema } from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import { CredentialsService } from './credentials.service.js';
import type { User } from './user.js';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly credentials: CredentialsService,
    private readonly signInService: SignInService,
  ) {}

  /** Creates a clinic with its first owner and signs the owner in. */
  @Public()
  @Post('auth/sign-up')
  async signUp(@Body({ schema: signUpSchema }) body: SignUpDto): Promise<User> {
    const user = await this.authService.registerClinic(body);
    await this.signInService.signIn(user.id, { method: 'password' });
    return user;
  }

  @Public()
  @Post('auth/sign-in')
  @HttpCode(200)
  async signIn(@Body({ schema: signInSchema }) body: SignInDto): Promise<User> {
    const user = await this.credentials.verify(body.email, body.password);
    if (!user) {
      // Same answer for an unknown email, a wrong password and a deactivated account.
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    await this.signInService.signIn(user.id, { method: 'password' });
    return user;
  }

  @Public()
  @Post('auth/sign-out')
  @HttpCode(204)
  async signOut(): Promise<void> {
    if (!(await this.signInService.signOut())) {
      throw new UnauthorizedException();
    }
  }

  @Get('me')
  @Can.Anyone()
  me(@CurrentUser() user: User): User {
    return user;
  }
}
