// ABOUTME: Vite client type augmentation — declares import.meta.env for our project vars.
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
