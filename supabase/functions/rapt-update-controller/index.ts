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
    const { controllerId, action, value } = await req.json();
    
    if (!controllerId || !action) {
      throw new Error('Controller ID and action are required');
    }

    console.log(`Updating RAPT controller ${controllerId}, action: ${action}, value:`, value);

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

    // Determine API endpoint based on action
    let endpoint = '';
    let body = {};

    switch (action) {
      case 'setTargetTemperature':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetTargetTemperature';
        body = {
          temperatureControllerId: controllerId,
          target: value
        };
        break;
      
      case 'setPIDEnabled':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetPIDEnabled';
        body = {
          temperatureControllerId: controllerId,
          enabled: value
        };
        break;
      
      case 'setPID':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetPID';
        body = {
          temperatureControllerId: controllerId,
          proportionalGain: value.proportionalGain,
          integralTime: value.integralTime,
          derivativeTime: value.derivativeTime
        };
        break;
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    console.log('Sending request to RAPT API:', endpoint, body);

    // Call RAPT API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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
    console.error('Error in rapt-update-controller function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
