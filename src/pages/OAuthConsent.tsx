import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const oauth = (supabase.auth as any).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Saknar authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError("Ingen omdirigering returnerades."); }
    window.location.href = target;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 space-y-4">
        {error ? (
          <p>Kunde inte läsa begäran: {error}</p>
        ) : !details ? (
          <p>Laddar…</p>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Anslut {details.client?.name ?? "en app"}</h1>
            <p className="text-muted-foreground">
              {details.client?.name ?? "Appen"} får läsa bryggdata som dig (endast läsning).
            </p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => decide(true)}>Godkänn</Button>
              <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Neka</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
