import { BrewData, PillData, TempController } from "@/types/brew";

export interface BrewCardProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
  isAuthenticated: boolean;
  pills: PillData[];
  controllers: TempController[];
  onShareBrew: (brew: BrewData) => void;
  onEventsChange: () => void;
  /** Index for staggered rendering */
  cardIndex?: number;
  /** Whether album art background is showing (for transparency effect) */
  hasAlbumArtBackground?: boolean;
  /** Number of brews displayed - affects TV chart proportions */
  brewCount?: number;
}

export interface DeviceMatch {
  pill: PillData | null;
  controller: TempController | null;
}

export interface StatCardProps {
  brew: BrewData;
  updatedFields: Record<string, Record<string, boolean>>;
}

export interface TempCardProps extends StatCardProps {
  devices: DeviceMatch;
}

export interface BatteryCardProps extends StatCardProps {
  devices: DeviceMatch;
}
