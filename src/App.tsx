import { useEffect, ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TvModeProvider, useTvMode } from "@/contexts/TvModeContext";
import { ExternalAuthProvider } from "@/contexts/ExternalAuthContext";
import { DashboardFooterProvider } from "@/contexts/DashboardFooterContext";
import { DashboardAlertProvider } from "@/contexts/DashboardAlertContext";
import { AlbumArtProvider } from "@/contexts/AlbumArtContext";
import { AlarmTimerProvider } from "@/contexts/AlarmTimerContext";
import { AspectRatioLayout } from "@/components/AspectRatioLayout";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import Settings from "./pages/Settings";
import Install from "./pages/Install";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Brew from "./pages/Brew";
import PrinterDebug from "./pages/PrinterDebug";


const queryClient = new QueryClient();

/** In TV mode, skip TooltipProvider (no mouse on Chromecast) */
function ConditionalTooltipProvider({ children }: { children: ReactNode }) {
  const { isTvMode } = useTvMode();
  if (isTvMode) return <>{children}</>;
  return <TooltipProvider>{children}</TooltipProvider>;
}

// Global error boundary for unhandled promise rejections
function useGlobalErrorHandler() {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("[Global] Unhandled rejection:", event.reason);
      event.preventDefault(); // Prevent browser default error handling
    };

    const handleError = (event: ErrorEvent) => {
      console.error("[Global] Unhandled error:", event.error);
    };

    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);
}

function AppContent() {
  useGlobalErrorHandler();
  const { isTvMode } = useTvMode();

  // Auto-register Web Push if permission already granted
  useEffect(() => {
    if (!isTvMode) {
      import("@/lib/web-push-registration").then(({ autoRegisterWebPush }) => {
        autoRegisterWebPush().catch(() => {});
      });
    }
  }, [isTvMode]);
  
  return (
    <ExternalAuthProvider>
      <DashboardFooterProvider>
        <DashboardAlertProvider>
          <AlbumArtProvider>
            <AlarmTimerProvider>
            <Routes>
              {/* Brew page without aspect ratio lock */}
              <Route path="/brew/:id" element={<Brew />} />
              
              {/* All other routes with aspect ratio lock using layout */}
              <Route element={<AspectRatioLayout />}>
                <Route path="/" element={<Index />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/install" element={<Install />} />
                <Route path="/login" element={<Login />} />
                
                <Route path="/printer-debug" element={<PrinterDebug />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
            </AlarmTimerProvider>
          </AlbumArtProvider>
        </DashboardAlertProvider>
      </DashboardFooterProvider>
    </ExternalAuthProvider>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TvModeProvider>
          <ConditionalTooltipProvider>
            <TvAwareToasters />
            <AppContent />
          </ConditionalTooltipProvider>
        </TvModeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>
);

/** Only render Toaster/Sonner outside TV mode */
function TvAwareToasters() {
  const { isTvMode } = useTvMode();
  if (isTvMode) return null;
  return (
    <>
      <Toaster />
      <Sonner />
    </>
  );
}

export default App;
