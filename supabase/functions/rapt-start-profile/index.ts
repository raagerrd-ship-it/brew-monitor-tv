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
    const { controllerId, profileId } = await req.json();
    
    if (!controllerId || !profileId) {
      throw new Error('Controller ID and Profile ID are required');
    }

    console.log(`Starting RAPT profile ${profileId} on controller ${controllerId}`);

    // Get RAPT credentials
    const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
    const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
    
    if (!RAPT_USERNAME || !RAPT_API_SECRET) {
      throw new Error('RAPT credentials not configured');
    }

    // Get bearer token
    const formData = new URLSearchParams();
    formData.append('client_id', 'rapt-user');
    formData.append('grant_type', 'password');
    formData.append('username', RAPT_USERNAME);
    formData.append('password', RAPT_API_SECRET);

    const authResponse = await fetch('https://id.rapt.io/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!authResponse.ok) {
      console.error('RAPT auth error:', authResponse.status);
      throw new Error(`RAPT auth error: ${authResponse.status}`);
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    // Start profile session on RAPT API
    const endpoint = 'https://api.rapt.io/api/Profiles/StartProfileSession';
    const queryParams = new URLSearchParams();
    queryParams.append('profileId', profileId);
    queryParams.append('deviceId', controllerId);

    const fullUrl = `${endpoint}?${queryParams.toString()}`;
    console.log('Sending request to RAPT API:', fullUrl);

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RAPT API error:', response.status, errorText);
      throw new Error(`RAPT API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('RAPT API response:', result);

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in rapt-start-profile function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
