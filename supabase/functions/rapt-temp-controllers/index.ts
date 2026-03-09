
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { access_token } = await req.json();
    
    if (!access_token) {
      throw new Error('Access token is required');
    }

    console.log('Fetching RAPT Temperature Controllers data...');

    // Get Temperature Controllers data from RAPT API
    const response = await fetch('https://api.rapt.io/api/TemperatureControllers/GetTemperatureControllers', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RAPT API error:', response.status, errorText);
      throw new Error(`RAPT API error: ${response.status}`);
    }

    const controllers = await response.json();
    console.log(`Successfully fetched ${controllers.length} Temperature Controllers`);
    if (controllers.length > 0) {
      console.log('First controller raw data:', JSON.stringify(controllers[0], null, 2));
    }

    return new Response(JSON.stringify(controllers), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in rapt-temp-controllers function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
