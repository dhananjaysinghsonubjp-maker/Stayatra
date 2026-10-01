import { useState } from 'react';
import type { Hotel } from '../types';

export type Tab =
  | 'dashboard'
  | 'rooms'
  | 'inhouse'
  | 'bookings'
  | 'dues'
  | 'housekeeping'
  | 'reports'
  | 'setup'
  | 'cm_calendar'
  | 'cm_rate_update'
  | 'cm_inventory_update'
  | 'cm_restrictions'
  | 'cm_dynamic_pricing'
  | 'cm_rate_plans'
  | 'cm_inventory'
  | 'cm_channels'
  | 'cm_credentials'
  | 'cm_reports'
  | 'cm_ledger'
  | 'billing'
  | 'audit_log';

type IconFn = (props: { className?: string }) => React.ReactElement;

interface LeafItem {
  id: Tab;
  label: string;
  icon: IconFn;
}

interface GroupItem {
  label: string;
  icon: IconFn;
  children: LeafItem[];
}

type NavEntry = LeafItem | GroupItem;

function isGroup(entry: NavEntry): entry is GroupItem {
  return 'children' in entry;
}

function Icon(path: string) {
  return ({ className = 'h-5 w-5' }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={path} />
    </svg>
  );
}

const CHEVRON = Icon('M9 5l7 7-7 7');
const BULK_UPDATE_ICON = Icon('M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3');

const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Icon('M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10M9 21h6') },
  { id: 'rooms', label: 'Room Board', icon: Icon('M4 6h16M4 6a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2M4 6l8-3 8 3M9 13h6') },
  { id: 'inhouse', label: 'In-House Guests', icon: Icon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z') },
  { id: 'bookings', label: 'Reservations', icon: Icon('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z') },
  { id: 'dues', label: 'Dues', icon: Icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z') },
  { id: 'housekeeping', label: 'Housekeeping', icon: Icon('M9 3v2m6-2v2M4 8h16M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8H5z') },
  { id: 'reports', label: 'Reports', icon: Icon('M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z') },
  {
    label: 'Bulk Update',
    icon: BULK_UPDATE_ICON,
    children: [
      { id: 'cm_rate_update', label: 'Rate Update', icon: Icon('M9 14l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z') },
      { id: 'cm_inventory_update', label: 'Inventory Update', icon: Icon('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4') },
    ],
  },
  { id: 'cm_calendar', label: 'Calendar', icon: Icon('M3 3h18v18H3V3zm0 6h18M3 15h18M9 3v18M15 3v18') },
  { id: 'cm_restrictions', label: 'Update Restrictions', icon: Icon('M12 15a3 3 0 100-6 3 3 0 000 6z M3 12h2m14 0h2M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M5.6 18.4l1.4-1.4m10-10l1.4-1.4') },
  { id: 'cm_dynamic_pricing', label: 'Value Override', icon: Icon('M12 8c-1.66 0-3 .9-3 2s1.34 2 3 2 3 .9 3 2-1.34 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 2v8m0 0v2m0-2c-1.11 0-2.08-.402-2.599-1') },
  { id: 'cm_rate_plans', label: 'Linked Rate Plan', icon: Icon('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z') },
  { id: 'cm_reports', label: 'Business Reports', icon: Icon('M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z') },
  { id: 'cm_ledger', label: 'Unified Ledger', icon: Icon('M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6') },
  { id: 'cm_channels', label: 'Connected Channels', icon: Icon('M13 10V3L4 14h7v7l9-11h-7z') },
  { id: 'cm_inventory', label: 'Linked Inventory', icon: Icon('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4') },
  { id: 'setup', label: 'Staff & Setup', icon: Icon('M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2.5a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2.5a2 2 0 114 0v.09c0 .68.39 1.29 1 1.51.35.15.75.09 1.09-.15l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.22.61.83 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z') },
  { id: 'cm_credentials', label: 'Credentials', icon: Icon('M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v2') },
  { id: 'billing', label: 'Billing', icon: Icon('M3 10h18M7 15h2m4 0h4M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z') },
  { id: 'audit_log', label: 'Audit Log', icon: Icon('M3 3v5h5M3.05 13a9 9 0 102.13-7.65M12 7v5l3 3') },
];

function visibleChildren(group: GroupItem, visibleTabs: Tab[]) {
  return group.children.filter((c) => visibleTabs.includes(c.id));
}

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'Bulk Update': true });

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
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
        {NAV.map((entry) => {
          if (isGroup(entry)) {
            const children = visibleChildren(entry, visibleTabs);
            if (children.length === 0) return null;
            const open = expanded[entry.label] ?? false;
            const groupActive = children.some((c) => c.id === tab);
            return (
              <div key={entry.label}>
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [entry.label]: !open }))}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    groupActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <entry.icon className={`h-[18px] w-[18px] ${groupActive ? 'text-brand-600' : 'text-slate-400'}`} />
                  <span className="flex-1 text-left">{entry.label}</span>
                  <CHEVRON className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                {open && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-3">
                    {children.map((child) => {
                      const active = tab === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => onTab(child.id)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          {child.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (!visibleTabs.includes(entry.id)) return null;
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              onClick={() => onTab(entry.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <entry.icon className={`h-[18px] w-[18px] ${active ? 'text-brand-600' : 'text-slate-400'}`} />
              {entry.label}
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
