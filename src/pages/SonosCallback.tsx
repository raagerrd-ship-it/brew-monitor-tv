import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, Music } from "lucide-react";

export default function SonosCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      if (error) {
        setStatus('error');
        setErrorMessage(errorDescription || error);
        return;
      }

      if (!code) {
        setStatus('error');
        setErrorMessage('Ingen auktoriseringskod mottagen');
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-auth?action=callback&code=${encodeURIComponent(code)}`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
          }
        );
        const data = await response.json();

        if (data.success) {
          setStatus('success');
          // Auto-redirect after success
          setTimeout(() => {
            navigate('/settings?tab=sync');
          }, 2000);
        } else {
          setStatus('error');
          setErrorMessage(data.error || 'Kunde inte slutföra kopplingen');
        }
      } catch (error) {
        console.error('Callback error:', error);
        setStatus('error');
        setErrorMessage('Ett oväntat fel uppstod');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-full bg-primary/10">
            <Music className="h-8 w-8 text-primary" />
          </div>
        </div>

        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Kopplar Sonos...</h2>
            <p className="text-muted-foreground">Vänligen vänta medan vi slutför anslutningen.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 text-ferment-green mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Sonos kopplat!</h2>
            <p className="text-muted-foreground mb-6">
              Ditt Sonos-konto har kopplats framgångsrikt.
              Du omdirigeras till inställningarna...
            </p>
            <Button onClick={() => navigate('/settings?tab=sync')}>
              Gå till Inställningar
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Något gick fel</h2>
            <p className="text-muted-foreground mb-6">{errorMessage}</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => navigate('/settings?tab=sync')}>
                Tillbaka
              </Button>
              <Button onClick={() => window.location.reload()}>
                Försök igen
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
