import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks";
import { Loader2, LogIn, ArrowLeft } from "lucide-react";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email({ message: "Ogiltig e-postadress" }).max(255),
  password: z.string().min(6, { message: "Lösenordet måste vara minst 6 tecken" }).max(255),
});

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/");
      }
    });

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate input
    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      toast({
        title: "Ogiltiga uppgifter",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: validation.data.email,
        password: validation.data.password,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast({
            title: "Inloggning misslyckades",
            description: "Felaktig e-post eller lösenord",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Inloggning misslyckades",
            description: error.message,
            variant: "destructive",
          });
        }
        return;
      }

      toast({
        title: "Välkommen!",
        description: "Du är nu inloggad",
      });
    } catch (error) {
      toast({
        title: "Ett fel uppstod",
        description: "Kunde inte logga in. Försök igen.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
      <Card className="w-full max-w-md p-8 space-y-6 relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="absolute top-4 left-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Tillbaka
        </Button>

        <div className="space-y-2 text-center mt-8">
          <h1 className="text-3xl font-bold text-glow brewing-title bg-gradient-to-r from-beer-amber via-primary to-ferment-green bg-clip-text text-transparent">
            Bryggövervakare
          </h1>
          <p className="text-muted-foreground">Logga in för att fortsätta</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-post</Label>
            <Input
              id="email"
              type="email"
              placeholder="din@epost.se"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Lösenord</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              maxLength={255}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loggar in...
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-4 w-4" />
                Logga in
              </>
            )}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center">
          Kontakta administratören för att få tillgång
        </p>
      </Card>
    </div>
  );
}
