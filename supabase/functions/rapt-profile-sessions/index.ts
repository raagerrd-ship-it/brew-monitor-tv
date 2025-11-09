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

    // Get all temperature controllers to find profile session information
    const controllersEndpoint = 'https://api.rapt.io/api/TemperatureControllers/GetTemperatureControllers';
    console.log('Requesting all controllers:', controllersEndpoint);

    const controllersResponse = await fetch(controllersEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!controllersResponse.ok) {
      const errorText = await controllersResponse.text();
      console.error('RAPT API error:', controllersResponse.status, errorText);
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const controllers = await controllersResponse.json();
    console.log(`Fetched ${controllers.length} controllers`);
    
    // Find the specific controller
    const controller = controllers.find((c: any) => c.id === controllerId);
    
    if (!controller) {
      console.log(`Controller ${controllerId} not found`);
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Found controller:', JSON.stringify(controller, null, 2));
    
    // Check if profile session info is in the controller data
    const sessions: any[] = [];
    if (controller.profileSession) {
      console.log('Found profileSession:', JSON.stringify(controller.profileSession, null, 2));
      sessions.push(controller.profileSession);
    } else if (controller.activeProfileSession) {
      console.log('Found activeProfileSession:', JSON.stringify(controller.activeProfileSession, null, 2));
      sessions.push(controller.activeProfileSession);
    } else if (controller.currentProfileSession) {
      console.log('Found currentProfileSession:', JSON.stringify(controller.currentProfileSession, null, 2));
      sessions.push(controller.currentProfileSession);
    } else {
      console.log('No profile session found in controller data. Controller keys:', Object.keys(controller));
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
