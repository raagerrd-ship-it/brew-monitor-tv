import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TvModeProvider } from "@/contexts/TvModeContext";
import { ExternalAuthProvider } from "@/contexts/ExternalAuthContext";
import { AspectRatioContainer } from "@/components/AspectRatioContainer";
import { TimerFooter } from "@/components/TimerFooter";
import Index from "./pages/Index";
import Settings from "./pages/Settings";
import Install from "./pages/Install";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import SonosCallback from "./pages/SonosCallback";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <TvModeProvider>
          <ExternalAuthProvider>
            <AspectRatioContainer>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/install" element={<Install />} />
                <Route path="/login" element={<Login />} />
                <Route path="/sonos-callback" element={<SonosCallback />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              <TimerFooter />
            </AspectRatioContainer>
          </ExternalAuthProvider>
        </TvModeProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
