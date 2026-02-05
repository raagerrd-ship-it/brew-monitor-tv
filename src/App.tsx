import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TvModeProvider } from "@/contexts/TvModeContext";
import { ExternalAuthProvider } from "@/contexts/ExternalAuthContext";
import { FpsCounterProvider } from "@/contexts/FpsCounterContext";
import { AspectRatioLayout } from "@/components/AspectRatioLayout";
import { FpsCounter } from "@/components/FpsCounter";
import { TvRefreshListener } from "@/components/TvRefreshListener";
import Index from "./pages/Index";
import Settings from "./pages/Settings";
import Install from "./pages/Install";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Brew from "./pages/Brew";
import SonosCallback from "./pages/SonosCallback";

const queryClient = new QueryClient();

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
  
  return (
    <TvModeProvider>
      <FpsCounterProvider>
        <ExternalAuthProvider>
          <TvRefreshListener />
          <Routes>
            {/* Brew page without aspect ratio lock */}
            <Route path="/brew/:id" element={<Brew />} />
            
            {/* All other routes with aspect ratio lock using layout */}
            <Route element={<AspectRatioLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/install" element={<Install />} />
              <Route path="/login" element={<Login />} />
              <Route path="/sonos-callback" element={<SonosCallback />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          {/* <FpsCounter /> */}{/* TEMP: Disabled for performance testing */}
        </ExternalAuthProvider>
      </FpsCounterProvider>
    </TvModeProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
