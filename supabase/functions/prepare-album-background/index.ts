import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  Percentage,
} from "npm:@imagemagick/magick-wasm@0.0.30";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Initialize magick-wasm once
const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30"),
  ),
);
await initializeImageMagick(wasmBytes);

// Simple hash for cache key
async function hashUrl(url: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageUrl is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reject local/private network URLs that the edge function can't reach
    try {
      const parsed = new URL(imageUrl);
      const host = parsed.hostname;
      if (
        host === 'localhost' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        return new Response(
          JSON.stringify({ error: 'Cannot fetch images from local network addresses' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid imageUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const hash = await hashUrl(imageUrl);
    const fileName = `bg_${hash}.jpg`;

    // Check if already cached in Storage
    const { data: existingFile } = await supabase.storage
      .from('album-backgrounds')
      .createSignedUrl(fileName, 1); // Just checking existence

    // If file exists, return public URL
    if (existingFile?.signedUrl) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/album-backgrounds/${fileName}`;
      console.log(`[AlbumBG] Cache hit for ${fileName} in ${Date.now() - startTime}ms`);
      return new Response(
        JSON.stringify({ backgroundUrl: publicUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Download original image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to download image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());

    // Process with magick-wasm: resize, blur, darken
    const processedBytes = ImageMagick.read(imageBytes, (img): Uint8Array => {
      // Resize to 400x400
      img.resize(400, 400);
      
      // Heavy gaussian blur (radius 40, sigma 20)
      img.blur(40, 20);
      
      // Darken to ~30% brightness using modulate (brightness=30, saturation=100, hue=100)
      img.modulate(new Percentage(30), new Percentage(100), new Percentage(100));
      
      // Write as JPEG with lower quality for smaller file size
      img.quality = 60;
      
      return img.write(
        MagickFormat.Jpeg,
        (data) => new Uint8Array(data),
      );
    });

    // Upload to Storage
    const { error: uploadError } = await supabase.storage
      .from('album-backgrounds')
      .upload(fileName, processedBytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('[AlbumBG] Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload processed image' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/album-backgrounds/${fileName}`;
    console.log(`[AlbumBG] Processed ${fileName} in ${Date.now() - startTime}ms (${processedBytes.length} bytes)`);

    return new Response(
      JSON.stringify({ backgroundUrl: publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[AlbumBG] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
