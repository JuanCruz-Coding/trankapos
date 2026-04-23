import type { DataDriver } from './driver';
import { LocalDriver } from './local/driver';
import { createSupabaseDriver } from './supabase/driver';

const mode = (import.meta.env.VITE_DATA_DRIVER as string | undefined) ?? 'local';

let driver: DataDriver;
if (mode === 'supabase') {
  driver = createSupabaseDriver();
} else {
  driver = new LocalDriver();
}

export const data: DataDriver = driver;
export type { DataDriver } from './driver';
