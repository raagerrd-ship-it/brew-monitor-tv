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
    
    // Otherwise, fetch batches with optional limit
    const allBatches: any[] = [];
    let startAfter = null;
    let hasMore = true;
    const requestedLimit = limit || 10;
    // Fetch more than requested to account for archived batches that will be filtered
    const maxBatchesToFetch = requestedLimit * 3; // Fetch 3x to ensure we have enough after filtering
    
    console.log('Fetching up to', maxBatchesToFetch, 'batches to get', requestedLimit, 'active ones');
    
    while (hasMore && allBatches.length < maxBatchesToFetch) {
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
        
        // If we got less than requested or reached our limit, we're done
        if (batches.length < fetchLimit || allBatches.length >= maxBatchesToFetch) {
          hasMore = false;
        } else {
          // Get the _id of the last batch for pagination
          startAfter = batches[batches.length - 1]._id;
        }
      }
    }

    // Filter out archived batches
    const activeBatches = allBatches.filter(batch => batch.status !== 'Archived');
    
    // Limit to requested number of active batches
    const limitedActiveBatches = activeBatches.slice(0, requestedLimit);
    
    console.log('Returning', limitedActiveBatches.length, 'active batches out of', allBatches.length, 'total batches (', activeBatches.length, 'active before limiting)');

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
