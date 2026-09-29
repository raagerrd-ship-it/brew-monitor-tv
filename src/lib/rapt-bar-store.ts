import { useSyncExternalStore } from 'react';
import type { TempController, PillData } from '@/types/brew';

export interface RaptBarState {
  controllers: TempController[];
  pills: PillData[];
  piDisabled: Record<string, boolean>;
  piManual: Record<string, boolean>;
  activeSessions: Record<string, boolean>;
  loaded: boolean;
  updatedAt: number;
}

// Delad källa: use-brew-data fyller den, headerns stapel läser den.
let state: RaptBarState = { controllers: [], pills: [], piDisabled: {}, piManual: {}, activeSessions: {}, loaded: false, updatedAt: 0 };
const listeners = new Set<() => void>();

export const setRaptBar = (next: Omit<RaptBarState, 'loaded' | 'updatedAt'>) => {
  state = { ...next, loaded: true, updatedAt: Date.now() };
  listeners.forEach((l) => l());
};

export const getRaptBar = () => state;

export const useRaptBarStore = () =>
  useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state
  );
