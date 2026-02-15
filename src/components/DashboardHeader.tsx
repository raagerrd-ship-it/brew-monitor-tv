import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { Clock } from "./Clock";
import { memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Settings, Pill, AirVent, LogOut, RefreshCw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTvMode } from "@/contexts/TvModeContext";
import { TempController } from "@/types/brew";
import { getControllerColor } from "@/lib/brew-utils";

const HEADER_HEIGHT_DESKTOP = 60;
const HEADER_HEIGHT_TV = 60;
const HEADER_HEIGHT = HEADER_HEIGHT_DESKTOP;
export { HEADER_HEIGHT, HEADER_HEIGHT_TV, HEADER_HEIGHT_DESKTOP };

interface DashboardHeaderProps {
  controllers: TempController[];
  pills: {
    pill_id: string;
    color: string;
    name: string;
    battery_level: number;
    last_update: string | null;
  }[];
  onControllerClick?: (controller: TempController) => void;
  hasAlbumArtBackground?: boolean;
  onLogout?: () => void;
  onRefresh?: () => void;
  sonosSlot?: React.ReactNode;
}

export function DashboardHeader({
  controllers,
  pills,
  onControllerClick,
  hasAlbumArtBackground = false,
  onLogout,
  onRefresh,
  sonosSlot,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const isOnSettings = location.pathname === '/settings';

  return (
    <div
      className={`overflow-visible z-20 ${isTvMode ? '' : 'transition-all duration-500'} ${isMobile ? 'flex flex-col py-3 px-3 gap-3 fixed top-0 left-0 right-0' : 'flex-shrink-0 flex items-center justify-between pl-2 pr-6 gap-6 relative'}`}
      style={{
        height: isMobile ? 'auto' : `${HEADER_HEIGHT_DESKTOP}px`,
        background: 'transparent',
        borderBottom: 'none'
      }}
    >
      {/* Top highlight removed for seamless transparent header */}

      {/* Mobile: Logo row with settings */}
      {isMobile ? (
        <div className="flex items-center justify-between w-full">
          <div className="cursor-pointer" onClick={() => navigate('/')}>
            <Logo />
          </div>
          <div className="flex items-center gap-1">
            {isOnSettings && onLogout && (
              <Button variant="ghost" size="icon" onClick={onLogout} className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-9 h-9 rounded-full">
                <LogOut className="w-4 h-4" />
              </Button>
            )}
            {onRefresh && !isOnSettings && (
              <div className="relative flex items-center justify-center" style={{ width: '36px', height: '36px' }}>
                <Button variant="ghost" size="icon" onClick={onRefresh} className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full">
                  <RefreshCw className="w-5 h-5" />
                </Button>
              </div>
            )}
            <div className="relative flex items-center justify-center" style={{ width: '36px', height: '36px' }}>
              <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className={`hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full ${isOnSettings ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
                <Settings className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* RAPT Section - Mobile */}
      {isMobile && controllers.length > 0 && (
        <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={onControllerClick || (() => {})} isMobile={true} isTvMode={isTvMode} />
      )}

      {/* Desktop: Three-column layout */}
      {!isMobile && (
        <>
          <div className="flex items-center flex-shrink-0" style={{ cursor: isTvMode ? 'default' : 'pointer' }} onClick={isTvMode ? undefined : () => navigate('/')}>
            {sonosSlot ?? <Logo />}
          </div>

          <div className="flex-1 flex items-center justify-center">
            {controllers.length > 0 && (
              <RaptControllerBar controllers={controllers} pills={pills} onControllerClick={onControllerClick || (() => {})} isMobile={false} isTvMode={isTvMode} />
            )}
          </div>

          <div className="flex items-center gap-4 flex-shrink-0 self-stretch">
            <Clock />

            {isOnSettings && onLogout && (
              <Button variant="ghost" size="icon" onClick={onLogout} className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-10 h-10 rounded-full">
                <LogOut className="w-5 h-5" />
              </Button>
            )}

            {!isTvMode && (
              <div className="relative flex items-center justify-center" style={{ width: '40px', height: '40px' }}>
                <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className={`hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full ${isOnSettings ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
                  <Settings className="transition-colors duration-200" style={{ width: '50%', height: '50%' }} />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Extracted sub-component for RAPT controller bar
interface RaptControllerBarProps {
  controllers: TempController[];
  pills: {
    pill_id: string;
    color: string;
    name: string;
    battery_level: number;
    last_update: string | null;
  }[];
  onControllerClick: (controller: TempController) => void;
  isMobile: boolean;
  isTvMode?: boolean;
}

export const RaptControllerBar = memo(function RaptControllerBar({
  controllers,
  pills,
  onControllerClick,
  isMobile,
  isTvMode = false
}: RaptControllerBarProps) {
  return (
    <div className={isMobile ? "flex items-center justify-center w-full" : ""}>
      <div className={`flex items-center rounded-lg ${isMobile ? 'gap-1 px-2 py-2' : 'gap-2 px-3 py-1'} overflow-x-auto scrollbar-hide backdrop-blur-xl`} style={{
        background: 'hsl(222 20% 11% / 0.65)',
        border: '1px solid hsl(222 15% 35% / 0.6)',
        boxShadow: '0 0 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      }}>
        {controllers.map((controller, index) => {
          const controllerColor = getControllerColor(controller.name);
          const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
          const isPillStale = linkedPill?.last_update ? (new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60) > 24 : true;
          return (
            <div key={controller.id} className="flex items-center">
              {index > 0 && <div className={`${isMobile ? 'h-6 mx-1' : 'h-8 mx-2'} w-px`} style={{ background: 'hsl(222 15% 20%)' }} />}

               <div className={`flex items-center flex-shrink-0 rounded ${isMobile ? 'px-2 py-1 gap-2' : 'px-3 py-1 gap-3'} ${isTvMode ? '' : 'cursor-pointer'}`} style={{ background: 'transparent' }}
                onClick={isTvMode ? undefined : () => onControllerClick(controller)}
                onMouseEnter={!isMobile && !isTvMode ? e => { e.currentTarget.style.background = 'hsl(222 18% 15%)'; } : undefined}
                onMouseLeave={!isMobile && !isTvMode ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
                title={!isMobile && !isTvMode ? `${controller.name}\nInbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°C${controller.pill_temp !== null ? `\nPill: ${controller.pill_temp.toFixed(1)}°C` : ''}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°C\n\nKlicka för att ändra inställningar` : undefined}
              >
                <AirVent style={{
                  width: isMobile ? '1rem' : '1rem',
                  height: isMobile ? '1rem' : '1rem',
                  color: controllerColor,
                  flexShrink: 0,
                  opacity: 0.7
                }} />

                <span className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-sm' : ''}`} style={{
                  fontSize: isMobile ? undefined : '16px',
                  color: linkedPill?.color || 'hsl(var(--foreground))'
                }}>
                  {controller.current_temp !== null ? `${controller.current_temp.toFixed(1)}°C` : '--°C'}
                </span>

                {linkedPill && (
                  <div className={`flex items-center gap-1 transition-opacity ${isPillStale ? 'opacity-40' : isMobile ? 'opacity-60' : ''}`} title={!isMobile ? `${linkedPill.name}\nBatteri: ${linkedPill.battery_level}%${isPillStale ? '\n⚠️ Ingen uppdatering på >24h' : ''}` : undefined}>
                    <div className="relative flex items-center">
                      <Pill style={{
                        width: isMobile ? '0.7rem' : '0.7rem',
                        height: isMobile ? '0.7rem' : '0.7rem',
                        flexShrink: 0
                      }} color={linkedPill.color} strokeWidth={2} />
                    </div>
                    <span className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-[10px]' : ''}`} style={{
                      fontSize: isMobile ? undefined : '14px',
                      color: linkedPill.color
                    }}>
                      {linkedPill.battery_level}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
