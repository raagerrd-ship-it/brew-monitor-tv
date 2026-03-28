/**
 * Sonos group ID recovery.
 * Sonos group IDs are ephemeral — they change when speakers regroup.
 * This helper re-discovers the group by its saved name.
 */

const SONOS_API_URL = 'https://api.ws.sonos.com/control/api/v1';

interface RecoveryResult {
  groupId: string;
  groupName: string;
}

/**
 * Attempts to recover a Sonos group by name when the saved group ID is invalid.
 * Returns the new group ID if found, or null if the group name isn't available.
 */
export async function recoverGroupByName(
  supabase: any,
  accessToken: string,
  savedGroupName: string | null,
  settingsId: string,
  householdId?: string | null,
): Promise<RecoveryResult | null> {
  if (!savedGroupName) return null;

  try {
    // Get household ID if not provided
    let hId = householdId;
    if (!hId) {
      const hRes = await fetch(`${SONOS_API_URL}/households`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!hRes.ok) return null;
      const hData = await hRes.json();
      hId = hData.households?.[0]?.id;
      if (!hId) return null;
    }

    const gRes = await fetch(`${SONOS_API_URL}/households/${hId}/groups`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!gRes.ok) return null;
    const gData = await gRes.json();

    const match = (gData.groups || []).find(
      (g: any) => g.name === savedGroupName
    );
    if (!match) {
      console.log(`[SonosGroupRecovery] "${savedGroupName}" not found among ${gData.groups?.length ?? 0} groups`);
      return null;
    }

    // Update saved group ID
    await supabase.from('sonos_settings')
      .update({ selected_group_id: match.id })
      .eq('id', settingsId);

    console.log(`[SonosGroupRecovery] Recovered "${savedGroupName}": ${match.id}`);
    return { groupId: match.id, groupName: match.name };
  } catch (e) {
    console.error('[SonosGroupRecovery] Error:', e);
    return null;
  }
}
