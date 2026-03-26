import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { BrewCard } from "@/components/brew-card/BrewCard";
import dbLogo from "@/assets/db-logo.png";
import { useBrewPage } from "@/hooks";

// Update document title and favicon when brew is loaded
const useDocumentTitleAndIcon = (title: string | null) => {
  useEffect(() => {
    const originalIcon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    const originalHref = originalIcon?.href;

    if (title) {
      document.title = `${title} - Dahlsjö Brewing`;
      let iconLink = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (!iconLink) {
        iconLink = document.createElement('link');
        iconLink.rel = 'icon';
        document.head.appendChild(iconLink);
      }
      iconLink.href = '/brew-icon.png';
    }
    
    return () => {
      document.title = "Bryggövervakare";
      const iconLink = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (iconLink && originalHref) {
        iconLink.href = originalHref;
      }
    };
  }, [title]);
};

export default function Brew() {
  const { id } = useParams<{ id: string }>();
  const { brew, pills, controllers, loading, error } = useBrewPage(id);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [labelExpanded, setLabelExpanded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashElapsed(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const showSplash = !minSplashElapsed || loading;

  useDocumentTitleAndIcon(brew?.name ?? null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !brew) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Ölen hittades inte</h1>
          <p className="text-muted-foreground">{error || "Kontrollera att länken är korrekt"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      {showSplash && (
        <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
          <img src={dbLogo} alt="Dahlsjö Brewing" className="max-h-[60vh] w-auto object-contain invert" />
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex justify-center">
          <img src={dbLogo} alt="Dahlsjö Brewing" className="h-24 md:h-32 w-auto opacity-90 invert" />
        </div>
        
        {(brew.label_image_url || brew.description) && (
          <div className="bg-card/50 backdrop-blur-xl rounded-xl border border-white/10 p-4 md:p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row gap-4 md:gap-6 items-start">
              {brew.label_image_url && (
                <div className="flex-shrink-0 mx-auto sm:mx-0 cursor-pointer" onClick={() => setLabelExpanded(v => !v)}>
                  <img
                    src={brew.label_image_url}
                    alt={`${brew.name} etikett`}
                    className="max-h-48 sm:max-h-48 md:max-h-64 w-auto rounded-lg shadow-lg border border-white/10 hover:ring-2 hover:ring-primary/50 transition-all"
                  />
                  <p className="text-xs text-muted-foreground text-center mt-1">Tryck för att förstora</p>
                </div>
              )}
              {brew.description && (
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Om ölet</h3>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line text-sm md:text-base">
                    {brew.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="h-[600px] md:h-[700px]">
          {labelExpanded && brew.label_image_url ? (
            <div
              className="w-full h-full flex items-center justify-center bg-card/50 backdrop-blur-xl rounded-xl border border-white/10 shadow-xl cursor-pointer"
              onClick={() => setLabelExpanded(false)}
            >
              <img
                src={brew.label_image_url}
                alt={`${brew.name} etikett`}
                className="max-h-full max-w-full object-contain rounded-lg"
              />
            </div>
          ) : (
            <BrewCard
              brew={brew}
              updatedFields={{}}
              isAuthenticated={false}
              pills={pills}
              controllers={controllers}
              onShareBrew={() => {}}
              onEventsChange={() => {}}
              cardIndex={0}
              pillCompEnabled={pillCompEnabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}
