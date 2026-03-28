

## Force AI Audit – Verifiera aktiva bryggningar

**Vad:** Anropa `ai-automation-audit` med `force: true` och sedan läsa senaste posten i `ai_audit_log` för att bekräfta att enbart **Skogens Sus** och **Mjöd** analyseras (inga arkiverade Brewfather-batchar).

**Steg:**
1. Kör `supabase--curl_edge_functions` mot `ai-automation-audit` med `{ "force": true }`
2. Vänta kort, sedan läs senaste raden i `ai_audit_log` via `supabase--read_query`
3. Verifiera att `analysis`-texten bara nämner Skogens Sus och Mjöd

