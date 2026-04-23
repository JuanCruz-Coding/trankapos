/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_DRIVER?: 'local' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
