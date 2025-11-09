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
    const { controllerId } = await req.json();
    
    if (!controllerId) {
      throw new Error('Controller ID is required');
    }

    console.log(`Fetching profile sessions for controller ${controllerId}`);

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

    // Try different endpoints to find profile session information
    // First, try GetTemperatureController to see if it includes profile info
    const controllerEndpoint = `https://api.rapt.io/api/TemperatureControllers/GetTemperatureController?id=${controllerId}`;
    console.log('Requesting controller details:', controllerEndpoint);

    const controllerResponse = await fetch(controllerEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!controllerResponse.ok) {
      const errorText = await controllerResponse.text();
      console.error('RAPT API error:', controllerResponse.status, errorText);
      
      // Return empty array if endpoint doesn't work
      if (controllerResponse.status === 404) {
        console.log('GetTemperatureController returned 404, returning empty array');
        return new Response(JSON.stringify([]), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`RAPT API error: ${controllerResponse.status} - ${errorText}`);
    }

    const controllerData = await controllerResponse.json();
    console.log('Controller data:', JSON.stringify(controllerData, null, 2));
    
    // Check if profile session info is in the controller data
    const sessions: any[] = [];
    if (controllerData.profileSession || controllerData.activeProfileSession) {
      const profileSession = controllerData.profileSession || controllerData.activeProfileSession;
      if (profileSession) {
        sessions.push(profileSession);
      }
    }

    return new Response(JSON.stringify(sessions), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in rapt-profile-sessions function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
