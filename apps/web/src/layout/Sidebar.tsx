import { useState } from 'react';
import { assetUrl } from '../api';
import type { Hotel } from '../types';

export type Tab =
  | 'dashboard'
  | 'rooms'
  | 'inhouse'
  | 'bookings'
  | 'dues'
  | 'ledger'
  | 'contacts'
  | 'housekeeping'
  | 'reports'
  | 'cm_calendar'
  | 'cm_guest_messaging'
  | 'cm_reviews'
  | 'cm_rate_inventory_update'
  | 'cm_advance_bulk_update'
  | 'cm_inventory'
  | 'cm_channels'
  | 'cm_reports'
  | 'settings_details'
  | 'settings_brand'
  | 'settings_rooms'
  | 'settings_invoice'
  | 'settings_ledger'
  | 'settings_credentials'
  | 'settings_billing'
  | 'audit_log';

type IconFn = (props: { className?: string }) => React.ReactElement;

interface LeafItem {
  id: Tab;
  label: string;
  icon: IconFn;
}

// §user request — "Hotel Team" (Housekeeping + Important Contacts) nests inside Settings, so a
// group can now hold either leaves or further groups, not just leaves — the nav was one level
// deep until this request needed a second one.
interface GroupItem {
  label: string;
  icon: IconFn;
  children: NavEntry[];
}

type NavEntry = LeafItem | GroupItem;

function isGroup(entry: NavEntry): entry is GroupItem {
  return 'children' in entry;
}

function isEntryVisible(entry: NavEntry, visibleTabs: Tab[]): boolean {
  return isGroup(entry) ? entry.children.some((c) => isEntryVisible(c, visibleTabs)) : visibleTabs.includes(entry.id);
}

function groupContainsTab(entry: NavEntry, tab: Tab): boolean {
  return isGroup(entry) ? entry.children.some((c) => groupContainsTab(c, tab)) : entry.id === tab;
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
  {
    label: 'Stay View',
    icon: Icon('M4 6h16M4 6a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2M4 6l8-3 8 3M9 13h6'),
    children: [
      { id: 'rooms', label: 'Room View', icon: Icon('M4 6h16M4 6a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2M4 6l8-3 8 3M9 13h6') },
      { id: 'inhouse', label: 'In-House Guests', icon: Icon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z') },
    ],
  },
  { id: 'cm_calendar', label: 'Calendar View', icon: Icon('M3 3h18v18H3V3zm0 6h18M3 15h18M9 3v18M15 3v18') },
  { id: 'bookings', label: 'Reservations', icon: Icon('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z') },
  { id: 'dues', label: 'Dues', icon: Icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z') },
  { id: 'ledger', label: 'Ledger', icon: Icon('M9 7h6m-6 4h6m-6 4h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z') },
  { id: 'reports', label: 'Reports', icon: Icon('M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z') },
  {
    // §user request — "Bulk Update ka naam change hoke Room Management hoga"
    label: 'Room Management',
    icon: BULK_UPDATE_ICON,
    children: [
      {
        // §user request — "Rate Update/Inventory Update ko sort/simple karo": those two separate
        // pages are gone, folded into this one tool (now the only place for bulk rate+inventory,
        // plus the Walk-in/Manual Room Block moved down from the old Inventory Update page).
        id: 'cm_rate_inventory_update',
        label: 'Rate & Invt. Update',
        icon: Icon('M9 7h6m-6 4h6m-6 4h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z'),
      },
      {
        id: 'cm_advance_bulk_update',
        label: 'Advance Update',
        icon: Icon('M12 15a3 3 0 100-6 3 3 0 000 6z M3 12h2m14 0h2M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M5.6 18.4l1.4-1.4m10-10l1.4-1.4'),
      },
    ],
  },
  {
    id: 'cm_guest_messaging',
    label: 'Guest Messaging',
    icon: Icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  },
  { id: 'cm_reviews', label: 'OTA Reviews', icon: Icon('M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.588 0l-4.725 2.885a.562.562 0 01-.84-.61l1.285-5.385a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345l2.125-5.11z') },
  { id: 'cm_reports', label: 'Business Reports', icon: Icon('M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z') },
  { id: 'cm_channels', label: 'Connected Channels', icon: Icon('M13 10V3L4 14h7v7l9-11h-7z') },
  { id: 'cm_inventory', label: 'Linked Inventory', icon: Icon('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4') },
  {
    label: 'Settings',
    icon: Icon('M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2.5a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2.5a2 2 0 114 0v.09c0 .68.39 1.29 1 1.51.35.15.75.09 1.09-.15l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.22.61.83 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z'),
    children: [
      { id: 'settings_details', label: 'Hotel Details', icon: Icon('M12 21c-4.5-4.03-7-7.42-7-10.5A7 7 0 0119 10.5c0 3.08-2.5 6.47-7 10.5zM12 12a2 2 0 100-4 2 2 0 000 4z') },
      {
        label: 'Hotel Team',
        icon: Icon('M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z'),
        children: [
          // §user request — "Housekeeping section ko replace karke naam Staff karo, uske andar
          // poora Staff & PINs wala roster rahega": same Tab id ('housekeeping'), reused for the
          // combined Staff+Housekeeping-Records page (HotelTeamStaffPage) now — Staff & PINs
          // below is gone, merged in here instead of being a separate Settings entry.
          { id: 'housekeeping', label: 'Staff', icon: Icon('M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m5-3.13a4 4 0 100-8 4 4 0 000 8zm6 2a4 4 0 100-8') },
          {
            id: 'contacts',
            label: 'Important Contacts',
            icon: Icon(
              'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
            ),
          },
        ],
      },
      { id: 'settings_brand', label: 'Hotel Brand', icon: Icon('M7 21h10M9 3h6l1 7a4 4 0 01-8 0l1-7zM12 14v7') },
      { id: 'settings_rooms', label: 'Room Setup', icon: Icon('M3 7v13m0-13l9-4 9 4m-18 0v13m18-13v13M3 20h18M9 10h.01M9 14h.01M15 10h.01M15 14h.01') },
      { id: 'settings_invoice', label: 'Invoice Settings', icon: Icon('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z') },
      { id: 'settings_ledger', label: 'Ledger Categories', icon: Icon('M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z') },
      { id: 'settings_credentials', label: 'Credentials', icon: Icon('M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v2') },
      { id: 'settings_billing', label: 'Billing', icon: Icon('M3 10h18M7 15h2m4 0h4M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z') },
    ],
  },
  { id: 'audit_log', label: 'Audit Log', icon: Icon('M3 3v5h5M3.05 13a9 9 0 102.13-7.65M12 7v5l3 3') },
];

function visibleChildren(group: GroupItem, visibleTabs: Tab[]) {
  return group.children.filter((c) => isEntryVisible(c, visibleTabs));
}

/** Recursive so a group (e.g. Settings) can hold another group (e.g. Hotel Team) as one of its
 * own children — indentation just compounds naturally from each nested level's own `pl-3`
 * container, no depth prop needed. `topLevel` only changes how a *leaf* renders (icon + the
 * bolder outer style vs. the original plain-text inner-group style) — a group header keeps the
 * same icon+chevron look at any depth, that part was never position-dependent. */
function NavNode({
  entry,
  tab,
  visibleTabs,
  expanded,
  setExpanded,
  selectTab,
  topLevel = false,
}: {
  entry: NavEntry;
  tab: Tab;
  visibleTabs: Tab[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectTab: (id: Tab) => void;
  topLevel?: boolean;
}) {
  if (isGroup(entry)) {
    const children = visibleChildren(entry, visibleTabs);
    if (children.length === 0) return null;
    const open = expanded[entry.label] ?? false;
    const groupActive = children.some((c) => groupContainsTab(c, tab));
    return (
      <div>
        <button
          onClick={() => setExpanded((prev) => ({ ...prev, [entry.label]: !open }))}
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            groupActive
              ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-400/20'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
          }`}
        >
          <entry.icon className={`h-[18px] w-[18px] ${groupActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'}`} />
          <span className="flex-1 text-left">{entry.label}</span>
          <CHEVRON className={`h-3.5 w-3.5 text-slate-400 transition-transform dark:text-slate-500 ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-3 dark:border-slate-700">
            {children.map((child) => (
              <NavNode
                key={isGroup(child) ? child.label : child.id}
                entry={child}
                tab={tab}
                visibleTabs={visibleTabs}
                expanded={expanded}
                setExpanded={setExpanded}
                selectTab={selectTab}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!visibleTabs.includes(entry.id)) return null;
  const active = tab === entry.id;
  if (!topLevel) {
    // Original inner-group leaf style — plain text, no icon, lighter weight.
    return (
      <button
        onClick={() => selectTab(entry.id)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-400/20'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
        }`}
      >
        {entry.label}
      </button>
    );
  }
  return (
    <button
      onClick={() => selectTab(entry.id)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-400/20'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
      }`}
    >
      <entry.icon className={`h-[18px] w-[18px] ${active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'}`} />
      {entry.label}
    </button>
  );
}

export function Sidebar({
  hotel,
  tab,
  onTab,
  visibleTabs,
  userLabel,
  roleLabel,
  onLogout,
  mobileOpen = false,
  onCloseMobile,
}: {
  hotel: Hotel | null;
  tab: Tab;
  onTab: (t: Tab) => void;
  visibleTabs: Tab[];
  userLabel: string;
  roleLabel: string;
  onLogout: () => void;
  /** §user request — phone responsive: below the `lg` breakpoint the sidebar is an off-canvas
   * drawer (hidden unless opened from the top bar's hamburger), not a permanently-docked column. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'Stay View': true, 'Room Management': true });

  function selectTab(id: Tab) {
    onTab(id);
    onCloseMobile?.();
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 -translate-x-full flex-col overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-700 dark:bg-slate-900 lg:static lg:w-60 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : ''
        }`}
      >
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
        {hotel?.logoFilePath ? (
          <img
            src={assetUrl(hotel.logoFilePath)}
            alt={hotel.name}
            className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-600"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold tracking-wide text-white shadow-sm">
            {hotel?.name?.[0]?.toUpperCase() ?? 'H'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{hotel?.name ?? 'StayYatra'}</p>
          {hotel && <p className="truncate text-xs text-slate-400 dark:text-slate-500">ID: {hotel.shortCode}</p>}
        </div>
        <button onClick={onCloseMobile} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden" aria-label="Close menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {NAV.map((entry) => (
          <NavNode
            key={isGroup(entry) ? entry.label : entry.id}
            entry={entry}
            tab={tab}
            visibleTabs={visibleTabs}
            expanded={expanded}
            setExpanded={setExpanded}
            selectTab={selectTab}
            topLevel
          />
        ))}
      </nav>

      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{userLabel}</p>
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{roleLabel}</p>
          </div>
          <button onClick={onLogout} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            Log out
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
