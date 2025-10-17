import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Smartphone, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function Install() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full p-8 space-y-6">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-24 h-24 bg-primary rounded-2xl flex items-center justify-center text-5xl">
              🍺
            </div>
          </div>
          
          <h1 className="text-3xl font-bold">Bryggövervakare</h1>
          
          {isInstalled ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 text-green-500">
                <CheckCircle className="w-6 h-6" />
                <p className="text-lg font-semibold">Appen är installerad!</p>
              </div>
              <Button onClick={() => navigate('/')} className="w-full">
                Öppna Dashboard
              </Button>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground">
                Installera Bryggövervakare på din enhet för bästa upplevelse
              </p>

              <div className="space-y-4 text-left">
                <div className="flex gap-3">
                  <Smartphone className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">Fungerar offline</h3>
                    <p className="text-sm text-muted-foreground">
                      Övervaka din bryggning även utan internetanslutning
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Download className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">Snabb åtkomst</h3>
                    <p className="text-sm text-muted-foreground">
                      Lägg till på hemskärmen för enkel åtkomst
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <CheckCircle className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">Uppdateras automatiskt</h3>
                    <p className="text-sm text-muted-foreground">
                      Få alltid den senaste versionen automatiskt
                    </p>
                  </div>
                </div>
              </div>

              {deferredPrompt ? (
                <Button onClick={handleInstall} className="w-full" size="lg">
                  <Download className="w-5 h-5 mr-2" />
                  Installera nu
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    För att installera:
                  </p>
                  <div className="bg-muted p-4 rounded-lg text-sm space-y-2">
                    <p className="font-semibold">iPhone/iPad:</p>
                    <p>Tryck på delnings-ikonen och välj "Lägg till på hemskärmen"</p>
                    <p className="font-semibold mt-3">Android:</p>
                    <p>Öppna webbläsarens meny och välj "Installera app" eller "Lägg till på hemskärmen"</p>
                  </div>
                </div>
              )}

              <Button 
                variant="outline" 
                onClick={() => navigate('/')} 
                className="w-full"
              >
                Fortsätt i webbläsaren
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}