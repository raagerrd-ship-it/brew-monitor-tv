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
    const BREWFATHER_USER_ID = Deno.env.get('BREWFATHER_USER_ID');
    const BREWFATHER_API_KEY = Deno.env.get('BREWFATHER_API_KEY');
    
    if (!BREWFATHER_USER_ID || !BREWFATHER_API_KEY) {
      throw new Error('Brewfather credentials not configured');
    }

    const { batchIds, limit, complete } = await req.json();
    
    console.log('Received request with batchIds:', batchIds, 'limit:', limit, 'complete:', complete);
    
    // If specific batch IDs are requested, fetch those
    if (batchIds && Array.isArray(batchIds) && batchIds.length > 0) {
      const batchPromises = batchIds.map(async (batchId: string) => {
        const response = await fetch(
          `https://api.brewfather.app/v2/batches/${batchId}`,
          {
            headers: {
              'Authorization': `Basic ${btoa(`${BREWFATHER_USER_ID}:${BREWFATHER_API_KEY}`)}`,
            },
          }
        );
        
        if (!response.ok) {
          console.error(`Failed to fetch batch ${batchId}:`, response.status);
          return null;
        }
        
        return await response.json();
      });
      
      const batches = await Promise.all(batchPromises);
      const validBatches = batches.filter(batch => batch !== null);
      
      return new Response(JSON.stringify(validBatches), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Otherwise, fetch batches sorted by batch number (newest first)
    const requestedLimit = limit || 10;
    const url = new URL('https://api.brewfather.app/v2/batches');
    url.searchParams.set('limit', requestedLimit.toString());
    url.searchParams.set('order_by', 'batchNo');
    url.searchParams.set('order_by_direction', 'desc');
    url.searchParams.set('complete', 'false'); // Only fetch basic fields for faster response
    url.searchParams.set('include', 'recipe.style'); // Add style info which we display
    
    console.log('Fetching', requestedLimit, 'batches sorted by batchNo descending (optimized fields)');
    
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Basic ${btoa(`${BREWFATHER_USER_ID}:${BREWFATHER_API_KEY}`)}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Brewfather API error: ${response.status}`);
    }

    const batches = await response.json();
    
    console.log('Returning', batches.length, 'batches');

    return new Response(JSON.stringify(batches), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in brewfather-batches function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
