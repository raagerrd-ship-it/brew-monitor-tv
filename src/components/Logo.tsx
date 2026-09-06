import { memo } from "react";
import { Beer } from "lucide-react";
import { useIsMobile } from "@/hooks";

function LogoComponent() {
  const isMobile = useIsMobile();
  const size = isMobile ? 26 : 28;

  return (
    <span
      className="inline-flex items-center justify-center rounded-lg flex-shrink-0"
      style={{
        width: size + 12,
        height: size + 12,
        background: 'linear-gradient(160deg, hsl(36 60% 22%) 0%, hsl(28 45% 14%) 100%)',
        border: '1px solid hsl(36 60% 45% / 0.35)',
        boxShadow: '0 2px 8px hsl(30 80% 40% / 0.15)',
      }}
      aria-label="Bryggövervakaren"
    >
      <Beer
        size={size}
        strokeWidth={1.75}
        style={{ color: 'hsl(38 90% 62%)', filter: 'drop-shadow(0 0 6px hsl(36 95% 55% / 0.45))' }}
      />
    </span>
  );
}

export const Logo = memo(LogoComponent);
