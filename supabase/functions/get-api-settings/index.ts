
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const brewfatherUserId = Deno.env.get('BREWFATHER_USER_ID');
    const brewfatherApiKey = Deno.env.get('BREWFATHER_API_KEY');
    const raptUsername = Deno.env.get('RAPT_USERNAME');
    const raptApiSecret = Deno.env.get('RAPT_API_SECRET');

    // Helper function to mask secrets, showing only last 4 characters
    const maskSecret = (secret: string | undefined): string => {
      if (!secret) return 'Ej konfigurerad';
      if (secret.length <= 4) return '****';
      return '****' + secret.slice(-4);
    };

    const settings = {
      brewfather: {
        userId: brewfatherUserId ? maskSecret(brewfatherUserId) : 'Ej konfigurerad',
        apiKey: brewfatherApiKey ? maskSecret(brewfatherApiKey) : 'Ej konfigurerad',
        configured: !!(brewfatherUserId && brewfatherApiKey)
      },
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
