import { create } from 'zustand';

function getCurrentPeriodKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

interface AppState {
  selectedPeriod: string;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSelectedPeriod: (period: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedPeriod: getCurrentPeriodKey(),
  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSelectedPeriod: (period) => set({ selectedPeriod: period }),
}));
