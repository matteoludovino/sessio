import type { User } from './user.js';

// Tells @nestjs/authentication the user type once, so CurrentUser and AuthenticationContext are typed.
declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: User;
    refreshTokens: false;
  }
}
