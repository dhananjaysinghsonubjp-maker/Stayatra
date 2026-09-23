import type { Hotel } from '../types';

export type Tab = 'dashboard' | 'rooms' | 'inhouse' | 'bookings' | 'housekeeping' | 'reports' | 'grid' | 'setup';

interface NavItem {
  id: Tab;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
}

function Icon(path: string) {
  return ({ className = 'h-5 w-5' }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={path} />
    </svg>
  );
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Icon('M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10M9 21h6') },
  { id: 'rooms', label: 'Room Board', icon: Icon('M4 6h16M4 6a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2M4 6l8-3 8 3M9 13h6') },
  { id: 'inhouse', label: 'In-House Guests', icon: Icon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z') },
  { id: 'bookings', label: 'Reservations', icon: Icon('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z') },
  { id: 'housekeeping', label: 'Housekeeping', icon: Icon('M9 3v2m6-2v2M4 8h16M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8H5z') },
  { id: 'reports', label: 'Reports', icon: Icon('M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z') },
  { id: 'grid', label: 'Rate Grid', icon: Icon('M3 3h18v18H3V3zm0 6h18M3 15h18M9 3v18M15 3v18') },
  { id: 'setup', label: 'Staff & Setup', icon: Icon('M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2.5a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2.5a2 2 0 114 0v.09c0 .68.39 1.29 1 1.51.35.15.75.09 1.09-.15l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.22.61.83 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z') },
];

export function Sidebar({
  hotel,
  tab,
  onTab,
  visibleTabs,
  userLabel,
  roleLabel,
  onLogout,
}: {
  hotel: Hotel | null;
  tab: Tab;
  onTab: (t: Tab) => void;
  visibleTabs: Tab[];
  userLabel: string;
  roleLabel: string;
  onLogout: () => void;
}) {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          {hotel?.name?.[0] ?? 'H'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{hotel?.name ?? 'Hotel Platform'}</p>
          {hotel && <p className="truncate text-xs text-slate-400">ID: {hotel.shortCode}</p>}
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {NAV.filter((item) => visibleTabs.includes(item.id)).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTab(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className={`h-[18px] w-[18px] ${active ? 'text-brand-600' : 'text-slate-400'}`} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-700">{userLabel}</p>
            <p className="truncate text-xs text-slate-400">{roleLabel}</p>
          </div>
          <button onClick={onLogout} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
