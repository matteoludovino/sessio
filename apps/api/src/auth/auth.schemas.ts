import { z } from 'zod';

/** 12+ characters, no composition rules (NIST SP 800-63B); sign-in accepts older passwords. */
export const password = z.string().min(12).max(128);

export const signUpSchema = z.object({
  clinicName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  password,
});
export type SignUpDto = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
export type SignInDto = z.infer<typeof signInSchema>;
