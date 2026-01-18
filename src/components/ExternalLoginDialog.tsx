import { useState } from 'react';
import { useExternalAuth } from '@/contexts/ExternalAuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Beer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ExternalLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExternalLoginDialog({ open, onOpenChange }: ExternalLoginDialogProps) {
  const { signIn } = useExternalAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: 'Fyll i alla fält',
        description: 'Både e-post och lösenord krävs',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        toast({
          title: 'Inloggning misslyckades',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Inloggad!',
          description: 'Du är nu ansluten till brygg-timern',
        });
        onOpenChange(false);
        setEmail('');
        setPassword('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beer className="w-5 h-5" />
            Anslut till Brygg-timer
          </DialogTitle>
          <DialogDescription>
            Logga in med samma konto som du använder i brygg-appen för att visa aktiva timers.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="external-email">E-post</Label>
            <Input
              id="external-email"
              type="email"
              placeholder="din@epost.se"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="external-password">Lösenord</Label>
            <Input
              id="external-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loggar in...
              </>
            ) : (
              'Logga in'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
