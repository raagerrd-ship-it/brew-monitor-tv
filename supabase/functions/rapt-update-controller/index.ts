import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { controllerId, action, value, access_token: providedToken, source, pwm_label } = await req.json();
    
    if (!controllerId || typeof controllerId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(controllerId)) {
      throw new Error('Valid Controller ID is required');
    }
    if (!action || typeof action !== 'string') {
      throw new Error('Action is required');
    }
    const ALLOWED_ACTIONS = ['setTargetTemperature', 'setPIDEnabled', 'setPID', 'setCoolingHysteresis'];
    if (!ALLOWED_ACTIONS.includes(action)) {
      throw new Error(`Unknown action: ${action}. Allowed: ${ALLOWED_ACTIONS.join(', ')}`);
    }
    // Validate value based on action
    if (action === 'setTargetTemperature') {
      if (typeof value !== 'number' || value < -10 || value > 40) {
        throw new Error('Target temperature must be a number between -10 and 40');
      }
    } else if (action === 'setPIDEnabled') {
      if (typeof value !== 'boolean') {
        throw new Error('setPIDEnabled value must be a boolean');
      }
    } else if (action === 'setPID') {
      if (!value || typeof value !== 'object' || typeof value.proportionalGain !== 'number' || typeof value.integralTime !== 'number' || typeof value.derivativeTime !== 'number') {
        throw new Error('setPID requires proportionalGain, integralTime, and derivativeTime as numbers');
      }
    } else if (action === 'setCoolingHysteresis') {
      if (typeof value !== 'number' || value < 0.1 || value > 10) {
        throw new Error('Hysteresis must be a number between 0.1 and 10');
      }
    }

    console.log(`Updating RAPT controller ${controllerId}, action: ${action}`);

    let accessToken = providedToken;

    if (!accessToken) {
      // Get RAPT credentials and authenticate
      const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
      const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
      
      if (!RAPT_USERNAME || !RAPT_API_SECRET) {
        throw new Error('RAPT credentials not configured');
      }

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
        signal: AbortSignal.timeout(15000),
      });

      if (!authResponse.ok) {
        console.error('RAPT auth error:', authResponse.status);
        throw new Error(`RAPT auth error: ${authResponse.status}`);
      }

      const authData = await authResponse.json();
      accessToken = authData.access_token;
    } else {
      console.log('Using pre-authenticated RAPT token');
    }

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
      
      case 'setCoolingHysteresis':
        endpoint = 'https://api.rapt.io/api/TemperatureControllers/SetCoolingHysteresis';
        queryParams.append('temperatureControllerId', controllerId);
        queryParams.append('hysteresis', value.toString());
        break;

      // setHeatingHysteresis, setHeatingEnabled, setCoolingEnabled removed — not supported by RAPT API
      
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
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RAPT API error:', response.status, errorText);
      throw new Error(`RAPT API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('RAPT API response:', result);

    // Update database with new value immediately
     // SSOT: profile_target_temp = user's desired target (virtual, set by user or profile)
     //       target_temp = what PID sends to hardware (may differ when pill-comp is active)
     // CRITICAL: Only manual user changes should update profile_target_temp.
     // PWM bursts and automation (source='pwm'/'automation') only change target_temp.
     if (action === 'setTargetTemperature' && result === true) {
       try {
         const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
         const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
         const supabase = createClient(supabaseUrl, supabaseKey);

         // Read current target before updating
         const { data: currentData } = await supabase
           .from('rapt_temp_controllers')
           .select('target_temp, name')
           .eq('controller_id', controllerId)
           .single();

         const oldTarget = currentData?.target_temp ?? value;
         const controllerName = currentData?.name ?? controllerId;

         const isAutomationSource = source === 'pwm' || source === 'automation' || source === 'pid';
         const updateData: Record<string, unknown> = {
           target_temp: value,
           updated_at: new Date().toISOString(),
         };
         // Only update profile_target_temp for manual user changes
         if (!isAutomationSource) {
           updateData.profile_target_temp = value;
         }

         const { error: dbError } = await supabase
           .from('rapt_temp_controllers')
           .update(updateData)
           .eq('controller_id', controllerId);

        if (dbError) {
          console.error('Error updating database:', dbError);
        } else {
          console.log(`Updated database: controller ${controllerId} target_temp = ${value}${isAutomationSource ? '' : `, profile_target_temp = ${value}`}`);

          // Log the manual adjustment to decision history
          if (oldTarget !== value) {
            await supabase.from('auto_cooling_adjustments').insert({
              cooler_controller_id: controllerId,
              cooler_controller_name: controllerName,
              old_target_temp: oldTarget,
              new_target_temp: value,
              lowest_followed_temp: value,
              reason: source === 'pwm' ? `⚡ ${pwm_label || 'PWM burst'}: ${oldTarget}° → ${value}°` : `✏️ Manuell justering: ${oldTarget}° → ${value}°`,
              original_target_temp: value,
              followed_controller_name: controllerName,
            });
            console.log(`Logged manual adjustment: ${oldTarget}° → ${value}°`);
          }
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
