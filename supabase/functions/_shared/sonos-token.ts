/**
 * Shared Sonos token management.
 * Retrieves a valid access token, refreshing if expired.
 */
export async function getValidAccessToken(
  supabase: any,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; tokenId: string } | null> {
  const { data: tokenData } = await supabase
    .from('sonos_tokens')
    .select('*')
    .limit(1)
    .single();

  if (!tokenData) return null;

  const isExpired = new Date(tokenData.expires_at) < new Date();
  let accessToken = tokenData.access_token;

  if (isExpired) {
    console.log('[SonosToken] Token expired, refreshing...');

    const tokenResponse = await fetch('https://api.sonos.com/login/v3/oauth/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('[SonosToken] Token refresh failed:', tokenResponse.status);
      return null;
    }

    const tokens = await tokenResponse.json();
    accessToken = tokens.access_token;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await supabase
      .from('sonos_tokens')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt.toISOString(),
      })
      .eq('id', tokenData.id);
  }

  return { accessToken, tokenId: tokenData.id };
}
