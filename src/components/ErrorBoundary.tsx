import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorCount: number;
  lastErrorTime: number;
}

/**
 * Error Boundary that catches render errors and auto-recovers.
 * Designed for TV/Cast environments where user interaction is limited.
 * 
 * If multiple errors occur within a short time, it will reload the page
 * to clear any corrupted state.
 */
export class ErrorBoundary extends Component<Props, State> {
  private recoveryTimeout: number | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false,
      errorCount: 0,
      lastErrorTime: 0
    };
  }

  static getDerivedStateFromError(_: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);

    // Stale chunk after deploy: index.html in browser cache references a
    // hashed JS chunk that no longer exists on the server. Force one reload
    // (guarded by sessionStorage) so a fresh index.html is fetched.
    const msg = String(error?.message || error);
    const isChunkError =
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('error loading dynamically imported module');
    if (isChunkError) {
      const FLAG = 'chunk-reload-attempted';
      if (sessionStorage.getItem(FLAG) !== '1') {
        sessionStorage.setItem(FLAG, '1');
        console.log('[ErrorBoundary] Stale chunk detected — reloading once');
        window.location.reload();
        return;
      }
    }

    const now = Date.now();
    const timeSinceLastError = now - this.state.lastErrorTime;
    
    // If errors are happening frequently (within 30 seconds), increment counter
    const newErrorCount = timeSinceLastError < 30000 
      ? this.state.errorCount + 1 
      : 1;
    
    this.setState({ 
      errorCount: newErrorCount,
      lastErrorTime: now
    });
    
    // Never hard-reload interactive devices; this causes disruptive UX loops.
    if (newErrorCount >= 3) {
      const isTvMode = new URLSearchParams(window.location.search).get('tv') === 'true';
      const isChromecast = navigator.userAgent.toLowerCase().includes('crkey');

      if (isTvMode || isChromecast) {
        console.log("[ErrorBoundary] Too many errors on TV/Cast, reloading page...");
        window.location.reload();
        return;
      }

      console.warn("[ErrorBoundary] Too many errors, skipping hard reload on interactive device.");
    }
    
    // Auto-recover after 2 seconds (or longer after repeated failures)
    const recoveryDelay = newErrorCount >= 3 ? 5000 : 2000;
    this.recoveryTimeout = window.setTimeout(() => {
      console.log("[ErrorBoundary] Attempting auto-recovery...");
      this.setState({ hasError: false });
    }, recoveryDelay);
  }

  componentWillUnmount() {
    if (this.recoveryTimeout) {
      clearTimeout(this.recoveryTimeout);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      // Minimal fallback UI - auto-recovers after 2 seconds
      return (
        <div 
          className="min-h-screen w-full flex items-center justify-center"
          style={{ background: 'hsl(222 20% 9%)' }}
        >
          <div className="text-center text-white/60">
            <div className="animate-spin h-8 w-8 border-2 border-white/20 border-t-white/60 rounded-full mx-auto mb-4" />
            <p>Återhämtar...</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
