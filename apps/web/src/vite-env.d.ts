/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" on the public demo: the sign-in page offers the shared demo accounts. */
  readonly VITE_DEMO_MODE?: string;
}
