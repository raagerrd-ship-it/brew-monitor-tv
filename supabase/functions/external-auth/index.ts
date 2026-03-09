
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EXTERNAL_SUPABASE_URL = 'https://zmvkvpmwpyxdpbysomxl.supabase.co';
const EXTERNAL_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptdmt2cG13cHl4ZHBieXNvbXhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0OTQ2NTMsImV4cCI6MjA3OTA3MDY1M30.IC1xZyB_mphskudaRgMKNPQYvkwkNMsiXlsuYmlsiMY';

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const email = Deno.env.get('EXTERNAL_SUPABASE_EMAIL');
    const password = Deno.env.get('EXTERNAL_SUPABASE_PASSWORD');

    if (!email || !password) {
      console.log('Missing external credentials in secrets');
      return new Response(
        JSON.stringify({ 
          error: 'External credentials not configured',
          needsSetup: true 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Attempting to authenticate with external Supabase...');

    // Create external Supabase client
    const externalSupabase = createClient(
      EXTERNAL_SUPABASE_URL,
      EXTERNAL_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        }
      }
    );

    // Sign in with the stored credentials
    const { data, error } = await externalSupabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('External auth error:', error.message);
      return new Response(
        JSON.stringify({ 
          error: error.message,
          needsSetup: true 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('External auth successful for user:', data.user?.id);

    return new Response(
      JSON.stringify({
        session: data.session,
        user: data.user,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});