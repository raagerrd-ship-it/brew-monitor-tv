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
  scenario?: 'stall' | 'overshoot';
  heatingActive?: boolean;
  ambientTemp?: number;
  // Used for batching — caller identifies tanks
  tankId?: string;
}

interface AIRecommendation {
  action: 'raise_temp' | 'lower_temp' | 'hold' | 'wait' | 'pause_heating';
  degrees: number;
  confidence: number;
  reasoning: string;
  newTargetTemp: number | null;
}

function buildTankPrompt(context: FermentationContext, index: number): string {
  const sgTrend = context.sgHistory
    .slice(0, 10)
    .map(s => `${new Date(s.date).toLocaleDateString('sv-SE')}: ${s.value.toFixed(3)}`)
    .join('\n');

  const deltaTrend = context.deltaHistory
    .slice(0, 5)
    .map(d => `${new Date(d.recorded_at).toLocaleDateString('sv-SE')} ${new Date(d.recorded_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}: ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)}°C`)
    .join('\n');

  const scenario = context.scenario || 'stall';
  const overshootContext = scenario === 'overshoot' ? `
SCENARIO: OVERSHOOT-PREVENTION
Controllern värmer ölet men pill (ytan) har redan nått eller överskridit måltemperaturen medan controllerns sensor (kärnan) fortfarande är under target.
Detta innebär att värmen inte hinner fördelas jämnt i vätskan — ytan blir för varm medan kärnan släpar.

Möjliga åtgärder:
- "pause_heating": Sänk target temporärt (t.ex. 0.5-1°C under pill-temp) för att stoppa uppvärmningen och låta värmen jämna ut sig
- "lower_temp": Sänk target mer aggressivt om overshoot är stort
- "hold": Behåll nuvarande target om situationen inte är kritisk
- "wait": Om du behöver mer data

Tänk på:
- Pill mäter yttemperaturen (flyter ovanpå)
- Controller mäter kärn-/väggtemperaturen
- Värme stiger uppåt → ytan blir varm först
- Rumstemperatur: ${context.ambientTemp !== undefined ? `${context.ambientTemp}°C` : 'Okänd'}
- Om pill är mer än 1°C över target är det allvarligt
- Om pill är 0.3-1°C över target, överväg att pausa
- Ölstilen påverkar hur kritiskt overshoot är (lager = känsligare)` : '';

  return `--- TANK ${index + 1}: ${context.controllerName} ---
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

JÄSNINGSHASTIGHET: ${context.dailyRate.toFixed(4)} SG/dag
SCENARIO: ${scenario.toUpperCase()}
${overshootContext}

SG-HISTORIK (senaste mätningar):
${sgTrend || 'Ingen data'}

DELTA-TREND (pill vs controller):
${deltaTrend || 'Ingen data'}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Support both single context and batched array
    const isBatched = Array.isArray(body.tanks);
    const tanks: FermentationContext[] = isBatched ? body.tanks : [body];

    console.log(`🧠 AI Fermentation Advisor called for ${tanks.length} tank(s): ${tanks.map(t => `${t.brewName} (${t.scenario || 'stall'})`).join(', ')}`);

    const systemPrompt = `Du är en expert-bryggare och jäsningsrådgivare. Du analyserar jäsningsdata och ger konkreta temperaturrekommendationer.

Regler:
- Svara BARA med tool-call, ingen fritext.
- Du får ${tanks.length} tank(ar) att analysera. Returnera en rekommendation PER tank i ordningen de presenteras.
- "action" måste vara: raise_temp, lower_temp, hold, wait, eller pause_heating
- "degrees" är hur många grader att ändra (0 om hold/wait)
- "confidence" är 0-100 hur säker du är
- "reasoning" är en kort förklaring på svenska (max 2 meningar)
- "newTargetTemp" är den nya måltemperaturen, eller null om hold/wait
- Temperaturen för varje tank får ALDRIG vara under dess minTargetTemp eller över dess maxTargetTemp
- Om du är osäker, välj "wait" istället för att göra en farlig ändring
- Tänk på ölstilen! En belgisk dubbel tål högre temp än en lager.
- Positiv delta (pill > controller) = värme stiger uppåt / aktiv jäsning
- Sjunkande delta = jäsningen avtar / värmen jämnas ut
- pause_heating = sänk target temporärt så heatern slutar, låt värmen jämna ut sig
- Små steg (0.5-1°C) är säkrare än stora hopp`;

    const userPrompt = tanks.length === 1
      ? `Analysera denna jäsning och rekommendera en åtgärd:\n\n${buildTankPrompt(tanks[0], 0)}\n\nVad rekommenderar du?`
      : `Analysera dessa ${tanks.length} tankar och ge en rekommendation PER tank:\n\n${tanks.map((t, i) => buildTankPrompt(t, i)).join('\n\n')}\n\nGe en rekommendation per tank i ordningen ovan.`;

    // Build tools - single or batched
    const tools = tanks.length === 1
      ? [{
          type: 'function' as const,
          function: {
            name: 'fermentation_recommendation',
            description: 'Provide a temperature recommendation for the fermentation',
            parameters: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['raise_temp', 'lower_temp', 'hold', 'wait', 'pause_heating'] },
                degrees: { type: 'number' },
                confidence: { type: 'number' },
                reasoning: { type: 'string' },
                newTargetTemp: { type: 'number', nullable: true },
              },
              required: ['action', 'degrees', 'confidence', 'reasoning', 'newTargetTemp'],
              additionalProperties: false,
            },
          },
        }]
      : [{
          type: 'function' as const,
          function: {
            name: 'fermentation_recommendations',
            description: `Provide temperature recommendations for ${tanks.length} tanks`,
            parameters: {
              type: 'object',
              properties: {
                recommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      action: { type: 'string', enum: ['raise_temp', 'lower_temp', 'hold', 'wait', 'pause_heating'] },
                      degrees: { type: 'number' },
                      confidence: { type: 'number' },
                      reasoning: { type: 'string' },
                      newTargetTemp: { type: 'number', nullable: true },
                    },
                    required: ['action', 'degrees', 'confidence', 'reasoning', 'newTargetTemp'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['recommendations'],
              additionalProperties: false,
            },
          },
        }];

    const toolChoice = tanks.length === 1
      ? { type: 'function', function: { name: 'fermentation_recommendation' } }
      : { type: 'function', function: { name: 'fermentation_recommendations' } };

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
        tools,
        tool_choice: toolChoice,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error('AI rate limited');
        return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        console.error('AI credits exhausted');
        return new Response(JSON.stringify({ error: 'Credits exhausted', fallback: true }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'AI gateway error', fallback: true }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      console.error('Unexpected AI response format:', JSON.stringify(aiResult));
      return new Response(JSON.stringify({ error: 'Invalid AI response', fallback: true }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    // Normalize to array of recommendations
    let recommendations: AIRecommendation[];
    if (toolCall.function.name === 'fermentation_recommendation') {
      recommendations = [parsed as AIRecommendation];
    } else {
      recommendations = (parsed.recommendations || []) as AIRecommendation[];
    }

    // Validate bounds per tank
    recommendations.forEach((rec, i) => {
      if (rec.newTargetTemp !== null && i < tanks.length) {
        rec.newTargetTemp = Math.max(tanks[i].minTargetTemp, Math.min(tanks[i].maxTargetTemp, rec.newTargetTemp));
      }
    });

    for (let i = 0; i < recommendations.length; i++) {
      const rec = recommendations[i];
      const tankName = i < tanks.length ? tanks[i].brewName : `Tank ${i + 1}`;
      console.log(`🧠 AI Recommendation for ${tankName}: ${rec.action} ${rec.degrees}°C (confidence: ${rec.confidence}%)`);
      console.log(`   Reasoning: ${rec.reasoning}`);
      console.log(`   New target: ${rec.newTargetTemp ?? 'no change'}`);
    }

    // Return in batched format if batched request, else legacy single format
    if (isBatched) {
      return new Response(JSON.stringify({ 
        recommendations,
        fallback: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ 
        recommendation: recommendations[0],
        fallback: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
