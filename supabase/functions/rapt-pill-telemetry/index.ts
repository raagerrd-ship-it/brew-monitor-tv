
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { access_token, pill_id, start_date, end_date } = await req.json();
    
    if (!access_token) {
      throw new Error('Access token is required');
    }
    
    if (!pill_id) {
      throw new Error('Pill ID is required');
    }

    console.log(`Fetching telemetry for pill ${pill_id}...`);

    // Build URL with query params
    const params = new URLSearchParams({
      hydrometerId: pill_id,
    });
    
    if (start_date) {
      params.append('startDate', start_date);
    }
    if (end_date) {
      params.append('endDate', end_date);
    }

    const url = `https://api.rapt.io/api/Hydrometers/GetTelemetry?${params.toString()}`;
    console.log(`Fetching from: ${url}`);

    const response = await fetch(url, {
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

    const telemetry = await response.json();
    console.log(`Successfully fetched ${telemetry.length} telemetry records for pill ${pill_id}`);

    return new Response(JSON.stringify(telemetry), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in rapt-pill-telemetry function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
