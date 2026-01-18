import { createClient } from '@supabase/supabase-js';

const EXTERNAL_SUPABASE_URL = 'https://zmvkvpmwpyxdpbysomxl.supabase.co';
const EXTERNAL_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptdmt2cG13cHl4ZHBieXNvbXhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0OTQ2NTMsImV4cCI6MjA3OTA3MDY1M30.IC1xZyB_mphskudaRgMKNPQYvkwkNMsiXlsuYmlsiMY';

export const externalSupabase = createClient(
  EXTERNAL_SUPABASE_URL,
  EXTERNAL_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'external-supabase-auth',
    }
  }
);
