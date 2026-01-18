import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { externalSupabase } from '@/integrations/external-supabase/client';
import { supabase } from '@/integrations/supabase/client';

interface ExternalAuthContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const ExternalAuthContext = createContext<ExternalAuthContextType>({
  user: null,
  session: null,
  isAuthenticated: false,
  isLoading: true,
  needsSetup: false,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  refreshSession: async () => {},
});

export function ExternalAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Fetch session from edge function (uses stored credentials)
  const fetchSessionFromServer = useCallback(async () => {
    try {
      console.log('Fetching external auth from server...');
      const { data, error } = await supabase.functions.invoke('external-auth');
      
      if (error) {
        console.error('Error calling external-auth:', error);
        setIsLoading(false);
        return;
      }

      if (data?.needsSetup) {
        console.log('External auth needs setup');
        setNeedsSetup(true);
        setIsLoading(false);
        return;
      }

      if (data?.session && data?.user) {
        console.log('Got session from server for user:', data.user.id);
        
        // Set the session in the external Supabase client
        await externalSupabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        
        setSession(data.session);
        setUser(data.user);
        setNeedsSetup(false);
      }
      
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching session from server:', error);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener for the external Supabase
    const { data: { subscription } } = externalSupabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('External auth state change:', event);
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    // First try to get session from server (stored credentials)
    fetchSessionFromServer();

    return () => subscription.unsubscribe();
  }, [fetchSessionFromServer]);

  // Periodically refresh the session from server to keep it alive
  useEffect(() => {
    if (!session) return;

    const refreshInterval = setInterval(() => {
      console.log('Refreshing external session...');
      fetchSessionFromServer();
    }, 30 * 60 * 1000); // Refresh every 30 minutes

    return () => clearInterval(refreshInterval);
  }, [session, fetchSessionFromServer]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await externalSupabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error) {
      setNeedsSetup(false);
    }
    return { error: error as Error | null };
  }, []);

  const signOut = useCallback(async () => {
    await externalSupabase.auth.signOut();
    setNeedsSetup(true);
  }, []);

  const refreshSession = useCallback(async () => {
    await fetchSessionFromServer();
  }, [fetchSessionFromServer]);

  return (
    <ExternalAuthContext.Provider
      value={{
        user,
        session,
        isAuthenticated: !!session,
        isLoading,
        needsSetup,
        signIn,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </ExternalAuthContext.Provider>
  );
}

export function useExternalAuth() {
  return useContext(ExternalAuthContext);
}
