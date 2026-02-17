import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface FermentationContext {
  brewName: string;
  beerStyle: string;
  originalGravity: number;
  finalGravity: number;
  currentSG: number;
  currentTemp: number;
  targetTemp: number;
  pillTemp: number | null;
  controllerTemp: number | null;
  delta: number | null;
  dailyRate: number;
  progressPercent: number;
  sgHistory: Array<{ date: string; value: number }>;
  deltaHistory: Array<{ delta: number; recorded_at: string }>;
  controllerName: string;
  maxTargetTemp: number;
  minTargetTemp: number;
  hoursAtCurrentTemp: number;
}

interface AIRecommendation {
  action: 'raise_temp' | 'lower_temp' | 'hold' | 'wait';
  degrees: number;
  confidence: number;
  reasoning: string;
  newTargetTemp: number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const context: FermentationContext = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`🧠 AI Fermentation Advisor called for ${context.brewName}`);
    console.log(`   Style: ${context.beerStyle}, SG: ${context.currentSG}, FG target: ${context.finalGravity}`);
    console.log(`   Rate: ${context.dailyRate.toFixed(4)}/day, Progress: ${context.progressPercent.toFixed(0)}%`);
    console.log(`   Temp: ${context.currentTemp}°C (target: ${context.targetTemp}°C)`);

    // Build SG trend summary for last few days
    const sgTrend = context.sgHistory
      .slice(0, 10)
      .map(s => `${new Date(s.date).toLocaleDateString('sv-SE')}: ${s.value.toFixed(3)}`)
      .join('\n');

    const deltaTrend = context.deltaHistory
      .slice(0, 5)
      .map(d => `${new Date(d.recorded_at).toLocaleDateString('sv-SE')} ${new Date(d.recorded_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}: ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)}°C`)
      .join('\n');

    const systemPrompt = `Du är en expert-bryggare och jäsningsrådgivare. Du analyserar jäsningsdata och ger konkreta temperaturrekommendationer.

Regler:
- Svara BARA med tool-call, ingen fritext.
- "action" måste vara: raise_temp, lower_temp, hold, eller wait
- "degrees" är hur många grader att ändra (0 om hold/wait)
- "confidence" är 0-100 hur säker du är
- "reasoning" är en kort förklaring på svenska (max 2 meningar)
- "newTargetTemp" är den nya måltemperaturen, eller null om hold/wait
- Temperaturen får ALDRIG vara under ${context.minTargetTemp}°C eller över ${context.maxTargetTemp}°C
- Om du är osäker, välj "wait" istället för att göra en farlig ändring
- Tänk på ölstilen! En belgisk dubbel tål högre temp än en lager.
- Positiv delta (pill > controller) = aktiv jäsning genererar värme
- Sjunkande delta = jäsningen avtar
- Att höja temp kan hjälpa vid stuck fermentation men kan ge off-flavors
- Små steg (0.5-1°C) är säkrare än stora hopp`;

    const userPrompt = `Analysera denna jäsning och rekommendera en åtgärd:

ÖL: ${context.brewName}
STIL: ${context.beerStyle}
OG: ${context.originalGravity.toFixed(3)}
FG (mål): ${context.finalGravity.toFixed(3)}
Nuvarande SG: ${context.currentSG.toFixed(3)}
Progress: ${context.progressPercent.toFixed(0)}% av förväntad attenuation

TEMPERATUR:
- Controller (kärna): ${context.controllerTemp?.toFixed(1) ?? 'N/A'}°C
- Pill (yta): ${context.pillTemp?.toFixed(1) ?? 'N/A'}°C  
- Delta (yta-kärna): ${context.delta !== null ? `${context.delta >= 0 ? '+' : ''}${context.delta.toFixed(1)}°C` : 'N/A'}
- Nuvarande mål: ${context.targetTemp}°C
- Tillåtet intervall: ${context.minTargetTemp}°C - ${context.maxTargetTemp}°C
- Timmar på nuvarande temp: ${context.hoursAtCurrentTemp}

JÄSNINGSHASTIGHET: ${context.dailyRate.toFixed(4)} SG/dag (MYCKET LÅG - potentiell stall)

SG-HISTORIK (senaste mätningar):
${sgTrend || 'Ingen data'}

DELTA-TREND (pill vs controller):
${deltaTrend || 'Ingen data'}

Vad rekommenderar du?`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'fermentation_recommendation',
              description: 'Provide a temperature recommendation for the fermentation',
              parameters: {
                type: 'object',
                properties: {
                  action: { 
                    type: 'string', 
                    enum: ['raise_temp', 'lower_temp', 'hold', 'wait'],
                    description: 'What action to take'
                  },
                  degrees: { 
                    type: 'number', 
                    description: 'How many degrees to change (0 for hold/wait)' 
                  },
                  confidence: { 
                    type: 'number', 
                    description: 'Confidence level 0-100' 
                  },
                  reasoning: { 
                    type: 'string', 
                    description: 'Brief explanation in Swedish (max 2 sentences)' 
                  },
                  newTargetTemp: { 
                    type: 'number', 
                    description: 'New target temperature, or null if hold/wait',
                    nullable: true
                  },
                },
                required: ['action', 'degrees', 'confidence', 'reasoning', 'newTargetTemp'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'fermentation_recommendation' } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error('AI rate limited');
        return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        console.error('AI credits exhausted');
        return new Response(JSON.stringify({ error: 'Credits exhausted', fallback: true }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'AI gateway error', fallback: true }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await response.json();
    
    // Parse tool call response
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'fermentation_recommendation') {
      console.error('Unexpected AI response format:', JSON.stringify(aiResult));
      return new Response(JSON.stringify({ error: 'Invalid AI response', fallback: true }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recommendation: AIRecommendation = JSON.parse(toolCall.function.arguments);
    
    // Validate bounds
    if (recommendation.newTargetTemp !== null) {
      recommendation.newTargetTemp = Math.max(context.minTargetTemp, Math.min(context.maxTargetTemp, recommendation.newTargetTemp));
    }

    console.log(`🧠 AI Recommendation: ${recommendation.action} ${recommendation.degrees}°C (confidence: ${recommendation.confidence}%)`);
    console.log(`   Reasoning: ${recommendation.reasoning}`);
    console.log(`   New target: ${recommendation.newTargetTemp ?? 'no change'}`);

    return new Response(JSON.stringify({ 
      recommendation,
      fallback: false 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-fermentation-advisor:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        fallback: true 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
