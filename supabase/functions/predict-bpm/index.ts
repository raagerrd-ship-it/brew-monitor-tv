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
    const { trackName, artistName } = await req.json();
    
    if (!trackName || !artistName) {
      return new Response(
        JSON.stringify({ error: 'trackName and artistName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Fallback to hash-based estimation if no API key
      return new Response(
        JSON.stringify({ tempo: estimateTempo(trackName, artistName), energy: 0.6, source: 'fallback' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a music expert. Given a song title and artist, estimate the BPM (tempo) and energy level based on your knowledge of the song or similar songs by the artist. 
            
Respond ONLY with a JSON object like: {"tempo": 120, "energy": 0.7}

- tempo: BPM between 60-200
- energy: a value between 0.0 (calm) and 1.0 (high energy)

Be accurate if you know the song. If unsure, make an educated guess based on the artist's typical style and the song title's mood.`
          },
          {
            role: "user",
            content: `Song: "${trackName}" by ${artistName}`
          }
        ],
        temperature: 0.3,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 402) {
        // Rate limited or payment required - use fallback
        return new Response(
          JSON.stringify({ tempo: estimateTempo(trackName, artistName), energy: 0.6, source: 'fallback' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse the JSON response
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const tempo = Math.min(200, Math.max(60, parsed.tempo || 120));
        const energy = Math.min(1, Math.max(0, parsed.energy || 0.6));
        
        return new Response(
          JSON.stringify({ tempo, energy, source: 'ai' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch {
      // Failed to parse, use fallback
    }

    // Fallback if AI response couldn't be parsed
    return new Response(
      JSON.stringify({ tempo: estimateTempo(trackName, artistName), energy: 0.6, source: 'fallback' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('predict-bpm error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Fallback hash-based tempo estimation
function estimateTempo(trackName: string, artistName: string): number {
  const combined = `${trackName}|${artistName}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Generate tempo between 80-160 BPM
  return 80 + Math.abs(hash % 80);
}
