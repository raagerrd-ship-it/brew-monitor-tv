import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

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
    let queryParams = new URLSearchParams();

    switch (action) {
      case 'setTargetTemperature':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetTargetTemperature';
        queryParams.append('temperatureControllerId', controllerId);
        queryParams.append('target', value.toString());
        break;
      
      case 'setPIDEnabled':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetPIDEnabled';
        queryParams.append('temperatureControllerId', controllerId);
        queryParams.append('enabled', value.toString());
        break;
      
      case 'setPID':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetPID';
        queryParams.append('temperatureControllerId', controllerId);
        queryParams.append('proportionalGain', value.proportionalGain.toString());
        queryParams.append('integralTime', value.integralTime.toString());
        queryParams.append('derivativeTime', value.derivativeTime.toString());
        break;
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const fullUrl = `${endpoint}?${queryParams.toString()}`;
    console.log('Sending request to RAPT API:', fullUrl);

    // Call RAPT API
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

    // Update database with new value immediately
    if (action === 'setTargetTemperature' && result === true) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { error: dbError } = await supabase
          .from('rapt_temp_controllers')
          .update({ 
            target_temp: value,
            updated_at: new Date().toISOString()
          })
          .eq('controller_id', controllerId);

        if (dbError) {
          console.error('Error updating database:', dbError);
        } else {
          console.log(`Updated database: controller ${controllerId} target_temp = ${value}`);
        }
      } catch (dbUpdateError) {
        console.error('Database update error:', dbUpdateError);
        // Don't fail the request if DB update fails, API update was successful
      }
    }

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
