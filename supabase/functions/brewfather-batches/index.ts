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

    const { batchIds, limit } = await req.json();
    
    console.log('Received request with batchIds:', batchIds, 'and limit:', limit);
    
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
    
    // Otherwise, fetch batches until we have enough active ones
    const allBatches: any[] = [];
    const activeBatches: any[] = [];
    let startAfter = null;
    let hasMore = true;
    const requestedLimit = limit || 10;
    const maxBatchesToFetch = 100; // Safety limit to prevent infinite loops
    
    console.log('Fetching batches until we have', requestedLimit, 'active ones (max', maxBatchesToFetch, 'total)');
    
    while (hasMore && activeBatches.length < requestedLimit && allBatches.length < maxBatchesToFetch) {
      const url = new URL('https://api.brewfather.app/v2/batches');
      const fetchLimit = Math.min(50, maxBatchesToFetch - allBatches.length);
      url.searchParams.set('limit', fetchLimit.toString());
      if (startAfter) {
        url.searchParams.set('start_after', startAfter);
      }
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Basic ${btoa(`${BREWFATHER_USER_ID}:${BREWFATHER_API_KEY}`)}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Brewfather API error: ${response.status}`);
      }

      const batches = await response.json();
      
      if (!batches || batches.length === 0) {
        hasMore = false;
      } else {
        allBatches.push(...batches);
        
        // Filter and add active batches
        const newActiveBatches = batches.filter((batch: any) => batch.status !== 'Archived');
        activeBatches.push(...newActiveBatches);
        
        // If we got less than requested or reached our safety limit, we're done
        if (batches.length < fetchLimit || allBatches.length >= maxBatchesToFetch) {
          hasMore = false;
        } else if (activeBatches.length < requestedLimit) {
          // Continue fetching if we don't have enough active batches yet
          startAfter = batches[batches.length - 1]._id;
        } else {
          hasMore = false;
        }
      }
    }
    
    // Limit to requested number of active batches
    const limitedActiveBatches = activeBatches.slice(0, requestedLimit);
    
    console.log('Returning', limitedActiveBatches.length, 'active batches out of', allBatches.length, 'total batches fetched');

    return new Response(JSON.stringify(limitedActiveBatches), {
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
