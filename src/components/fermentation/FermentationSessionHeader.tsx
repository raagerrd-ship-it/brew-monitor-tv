import { Badge } from "@/components/ui/badge";
import { Play, Pause } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { SESSION_STATUS_LABELS } from "@/types/fermentation";

interface FermentationSessionHeaderProps {
  profileName: string;
  status: string;
  startedAt: string;
}

export function FermentationSessionHeader({
  profileName,
  status,
  startedAt,
}: FermentationSessionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-full ${status === 'paused' ? 'bg-muted' : 'bg-primary/20'}`}>
          {status === 'paused' ? (
            <Pause className="w-3 h-3 text-muted-foreground" />
          ) : (
            <Play className="w-3 h-3 text-primary" />
          )}
        </div>
        <div>
          <div className="text-sm font-medium">{profileName}</div>
          <div className="text-xs text-muted-foreground">
            Startad {formatDistanceToNow(new Date(startedAt), { addSuffix: true, locale: sv })}
          </div>
        </div>
      </div>
      <Badge variant={status === 'paused' ? 'secondary' : 'default'}>
        {SESSION_STATUS_LABELS[status]}
      </Badge>
    </div>
  );
}
