import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
    const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
    
    if (!RAPT_USERNAME || !RAPT_API_SECRET) {
      throw new Error('RAPT credentials not configured');
    }

    console.log('Requesting RAPT bearer token...');

    // Get bearer token from RAPT authentication server
    const formData = new URLSearchParams();
    formData.append('client_id', 'rapt-user');
    formData.append('grant_type', 'password');
    formData.append('username', RAPT_USERNAME);
    formData.append('password', RAPT_API_SECRET);

    const response = await fetch('https://id.rapt.io/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RAPT auth error:', response.status, errorText);
      throw new Error(`RAPT auth error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Successfully obtained RAPT bearer token');

    return new Response(JSON.stringify({ 
      access_token: data.access_token,
      expires_in: data.expires_in 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in rapt-auth function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
