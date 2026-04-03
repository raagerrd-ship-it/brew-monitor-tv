
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const raptUsername = Deno.env.get('RAPT_USERNAME');
    const raptApiSecret = Deno.env.get('RAPT_API_SECRET');

    const maskSecret = (secret: string | undefined): string => {
      if (!secret) return 'Ej konfigurerad';
      if (secret.length <= 4) return '****';
      return '****' + secret.slice(-4);
    };

    const settings = {
      rapt: {
        username: raptUsername || 'Ej konfigurerad',
        apiSecret: raptApiSecret ? maskSecret(raptApiSecret) : 'Ej konfigurerad',
        configured: !!(raptUsername && raptApiSecret)
      }
    };

    return new Response(JSON.stringify(settings), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in get-api-settings function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
