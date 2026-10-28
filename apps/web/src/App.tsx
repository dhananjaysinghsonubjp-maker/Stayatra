import { useEffect, useState } from 'react';
import { query } from './api';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider } from './ThemeContext';
import { LoginPanel } from './panels/LoginPanel';
import { Dashboard } from './panels/Dashboard';
import { Onboarding } from './panels/Onboarding';
import { RoomBoard } from './panels/RoomBoard';
import { InHouse } from './panels/InHouse';
import { Bookings } from './panels/Bookings';
import { Dues } from './panels/Dues';
import { Ledger } from './panels/Ledger';
import { Contacts } from './panels/Contacts';
import { HotelTeamStaffPage } from './panels/staff/HotelTeamStaffPage';
import { HousekeepingApp } from './panels/housekeeping/HousekeepingApp';
import { Reports } from './panels/Reports';
import { Calendar } from './panels/channel-manager/Calendar';
import { GuestMessaging } from './panels/channel-manager/GuestMessaging';
import { OtaReviews } from './panels/channel-manager/OtaReviews';
import { RateInventoryUpdate } from './panels/channel-manager/RateInventoryUpdate';
import { AdvanceBulkUpdate } from './panels/channel-manager/AdvanceBulkUpdate';
import { Inventory } from './panels/channel-manager/Inventory';
import { ConnectedChannels } from './panels/channel-manager/ConnectedChannels';
import { BusinessReports } from './panels/channel-manager/BusinessReports';
import { AuditLog } from './panels/AuditLog';
import { Sidebar, type Tab } from './layout/Sidebar';
import { NotificationBell } from './components/NotificationBell';
import { SubscriptionBanner } from './components/SubscriptionBanner';
import { ThemeToggle } from './components/ThemeToggle';
import { HelpDesk } from './components/HelpDesk';
import { applyBrandColor, isColorDark } from './brandColor';
import { applyBrandFont } from './brandFont';
import type { Hotel } from './types';

const HAMBURGER_TONE_CLASS: Record<'light' | 'dark', string> = {
  light: 'text-white hover:bg-white/15',
  dark: 'text-slate-900 hover:bg-black/10',
};

/** §user request — phone responsive: opens the off-canvas Sidebar drawer below the `lg`
 * breakpoint. Hidden on `lg`+, where the sidebar is permanently docked instead. */
function HamburgerButton({ tone, onClick }: { tone?: 'light' | 'dark'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open menu"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors lg:hidden ${tone ? HAMBURGER_TONE_CLASS[tone] : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

// §bugfix — "refresh karu toh 1 sec ke liye hotel-registration (map/address) screen dikhti hai
// phir Dashboard pe switch ho jata hai": `hotel` started as null, and `!hotel` was read as "this
// account has no property yet, show Onboarding" — true at the very start of every page load too,
// before the fetch below has even had a chance to resolve. A dedicated loading flag (distinct
// from "confirmed no hotel") keeps the screen on the same neutral loader `loading` below already
// uses, until the fetch actually answers the question.
const TAB_STORAGE_KEY = 'stayyatra.activeTab';

function Shell() {
  const { token, user, loading, logout, role } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [hotelLoading, setHotelLoading] = useState(true);
  // §bugfix — "refresh karu toh dashboard pe land karta hu, jis page pe tha vahi nahi rehta":
  // this was plain in-memory state with nothing to restore it from on a fresh page load.
  // Persisted across refreshes (not across logins — cleared in handleLogout below); still just
  // local state otherwise; see visibleTabs below for what happens if a restored tab turns out not
  // to be valid for this account (e.g. role changed, or a different account on the same browser).
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_STORAGE_KEY) as Tab | null) ?? 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Set by OTA Reviews' "Message" action (§ user request) — carries which guest's thread
  // Guest Messaging should open straight into, since tab switches here are just local state
  // with no routing/URL params to pass that through another way.
  const [pendingMessageBookingId, setPendingMessageBookingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // private-browsing/storage-blocked — the tab just won't survive a refresh, nothing else breaks.
    }
  }, [tab]);

  function handleLogout() {
    try {
      localStorage.removeItem(TAB_STORAGE_KEY);
    } catch {
      // see above
    }
    logout();
  }

  useEffect(() => {
    // Reset immediately on every user change — otherwise a brand-new owner with no
    // property yet would keep seeing whatever hotel was left over from a previous
    // session's state (e.g. landing straight on another account's dashboard instead
    // of the "List Your Property" wizard) until/unless the fetch below happened to
    // resolve to a non-empty result.
    setHotel(null);
    setHotelLoading(true);
    if (!user) return;
    const finish = (h: Hotel | null) => {
      setHotel(h);
      setHotelLoading(false);
    };
    if (user.hotelId) {
      query<Hotel>('hotels.get', { hotelId: user.hotelId }, token ?? undefined).then(finish);
    } else {
      query<Hotel[]>('hotels.list', undefined, token ?? undefined).then((hotels) => finish(hotels[0] ?? null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // §user request — a hotel's own picked brand colour/font re-themes the app (see brandColor.ts
  // / brandFont.ts). Re-applies whenever the active hotel changes and reverts to the app default
  // the moment there's no hotel (logout, brand-new account mid-onboarding).
  useEffect(() => {
    applyBrandColor(hotel?.brandColor);
  }, [hotel?.brandColor]);

  useEffect(() => {
    applyBrandFont(hotel?.fontFamily);
  }, [hotel?.fontFamily]);

  if (!token) return <LoginPanel />;
  if (loading || hotelLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
    );
  }

  const pmsRole = role('pms');
  const cmRole = role('channel_manager');
  // A plan grants a subset of modules (§5.4 — signup now creates roles only
  // for the modules actually purchased). Tab visibility used to check ONLY
  // role, never whether the module itself was enabled for this org, so a
  // PMS-only account still saw the Channel Manager tab and hit a FORBIDDEN
  // wall on click. `role(module)` is undefined whenever the org has no
  // UserModuleRole for it, so presence alone is the entitlement check.
  const hasPms = Boolean(pmsRole);
  const hasChannelManager = Boolean(cmRole);
  const isHousekeeping = pmsRole === 'housekeeping';
  const canManagePms = ['owner', 'manager'].includes(pmsRole ?? '');
  const canManageCm = ['owner', 'manager'].includes(cmRole ?? '');
  const canManage = canManagePms || canManageCm;
  // Billing concerns the whole org's subscription, not one module — visible to an owner
  // regardless of which module(s) that ownership is in, mirrors billing.router.ts's own check.
  const isOwner = pmsRole === 'owner' || cmRole === 'owner';

  if (!hotel) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <div className="mx-auto max-w-2xl px-4 py-12">
          <Onboarding hotel={null} onHotelCreated={setHotel} hasPms={hasPms} />
        </div>
      </div>
    );
  }

  // §user request, with actual Skymax app screenshots as the reference — housekeeping gets its
  // own dedicated 3-tab app shell (Rooms / My History / Profile), not the sidebar every other
  // role shares. Bypasses visibleTabs/Sidebar/the top bar entirely, same as Skymax's role-gated
  // native navigators.
  if (isHousekeeping) {
    return <HousekeepingApp hotel={hotel} onLogout={handleLogout} />;
  }

  // Reservations (§7 Phase 1 #5) is Channel-Manager content, not PMS-only —
  // a CM-only org has bookings pulled from its connected channels even with
  // no physical rooms/front desk at all, so it must see this tab too.
  const canSeeReservations = (hasPms || hasChannelManager) && !isHousekeeping;

  const cmTabs: Tab[] = [
    'cm_rate_inventory_update',
    'cm_advance_bulk_update',
    'cm_guest_messaging',
    'cm_reviews',
    'cm_reports',
    'cm_channels',
    'cm_inventory',
  ];
  // §user request — "CM me ek hi baar me multiple dates select karke edit kar sakte hain, PMS
  // me nahi": Calendar used to live only inside cmTabs, so a PMS-only org never saw it at all —
  // even though its Stays grid (and the same multi-date range picker) has nothing to do with
  // OTA connections. Split out of cmTabs so either module unlocks it (same gate as
  // canSeeReservations above); Calendar itself hides the rate/inventory-only controls when
  // hasChannelManager is false.

  const visibleTabs: Tab[] = [
    // §user request — matching the Skymax reference app: housekeeping never sees the
    // revenue/occupancy dashboard, only rooms and the cleaning flow.
    ...((!isHousekeeping ? ['dashboard'] : []) as Tab[]),
    ...((hasPms ? ['rooms'] : []) as Tab[]),
    ...((hasPms && !isHousekeeping ? ['inhouse'] : []) as Tab[]),
    ...((canSeeReservations ? ['bookings'] : []) as Tab[]),
    ...((hasPms && !isHousekeeping ? ['dues'] : []) as Tab[]),
    ...((hasPms && !isHousekeeping ? ['ledger'] : []) as Tab[]),
    ...((hasPms && !isHousekeeping ? ['contacts'] : []) as Tab[]),
    ...((canSeeReservations ? ['cm_calendar'] : []) as Tab[]),
    ...((hasChannelManager && !isHousekeeping ? cmTabs : []) as Tab[]),
    // §user request — "Housekeeping section ko replace karke Staff karo": this Tab id now
    // renders the combined Staff+Housekeeping-Records page (HotelTeamStaffPage), which includes
    // Staff & PINs' old content — same owner/manager bar that page already required.
    ...((canManagePms ? ['housekeeping'] : []) as Tab[]),
    // Reports is entirely PMS-shaped content (rooms/sales/housekeeping) and
    // its endpoints are PMS-role-gated server-side — a Channel-Manager-only
    // owner would just hit FORBIDDEN on every query, so this stays on the
    // narrower PMS check while Setup (which also covers shared Room
    // Categories) stays on the broader either-module check.
    ...(canManagePms ? (['reports'] as Tab[]) : []),
    ...(canManage ? (['settings_details', 'settings_brand', 'settings_rooms', 'settings_invoice', 'settings_ledger'] as Tab[]) : []),
    ...(canManage && hasChannelManager ? (['settings_credentials'] as Tab[]) : []),
    ...(canManage && isOwner ? (['settings_billing'] as Tab[]) : []),
    ...(canManage ? (['audit_log'] as Tab[]) : []),
  ];

  const roleLabel = (pmsRole ?? cmRole)?.replace('_', ' ') ?? 'no role';
  const bannerTone: 'light' | 'dark' = isColorDark(hotel.brandColor) ? 'light' : 'dark';
  // A tab restored from a previous session (see TAB_STORAGE_KEY above) might not be valid for
  // this account anymore — role changed, module no longer enabled, or a different account
  // entirely on the same browser. Falls back to Dashboard instead of rendering a blank content
  // area for a tab none of the blocks below match.
  const activeTab: Tab = visibleTabs.includes(tab) ? tab : 'dashboard';

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar
        hotel={hotel}
        tab={activeTab}
        onTab={setTab}
        visibleTabs={visibleTabs}
        userLabel={user?.userId.slice(0, 10) ?? ''}
        roleLabel={roleLabel}
        onLogout={handleLogout}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <main className="flex-1 overflow-y-auto">
        {isOwner && <SubscriptionBanner onViewBilling={() => setTab('settings_billing')} />}
        {hotel.bannerText ? (
          // §user request — "icon ko circle me mt karo, simply iska colour change kardo": no more
          // frosted-pill backdrops. The icons (and the banner text itself, which has the same
          // problem) just switch to plain white or dark based on how light/dark the chosen brand
          // colour actually is (isColorDark, brandColor.ts) — white-on-dark, dark-on-light.
          <div className="relative flex h-20 w-full items-center overflow-hidden bg-brand-600 px-4 sm:h-24 sm:px-8">
            <HamburgerButton tone={bannerTone} onClick={() => setMobileNavOpen(true)} />
            <span className={`truncate pr-24 text-base font-bold sm:pr-32 sm:text-2xl ${bannerTone === 'light' ? 'text-white' : 'text-slate-900'}`}>{hotel.bannerText}</span>
            <div className="absolute inset-y-0 right-0 flex items-center gap-1 px-2 sm:gap-2 sm:px-8">
              <ThemeToggle tone={bannerTone} />
              <HelpDesk tone={bannerTone} />
              <NotificationBell hotelId={hotel.id} onNavigate={setTab} tone={bannerTone} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1 border-b border-slate-100 bg-white px-2 py-2.5 dark:border-slate-700 dark:bg-slate-900 sm:justify-end sm:px-8">
            <HamburgerButton onClick={() => setMobileNavOpen(true)} />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <HelpDesk />
              <NotificationBell hotelId={hotel.id} onNavigate={setTab} />
            </div>
          </div>
        )}
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
          {activeTab === 'dashboard' && <Dashboard hotelId={hotel.id} hotelName={hotel.name} onNavigate={setTab} hasPms={hasPms} hasChannelManager={hasChannelManager} isOwner={isOwner} />}
          {activeTab === 'rooms' && hasPms && <RoomBoard hotelId={hotel.id} />}
          {activeTab === 'inhouse' && hasPms && !isHousekeeping && <InHouse hotelId={hotel.id} />}
          {activeTab === 'bookings' && canSeeReservations && <Bookings hotelId={hotel.id} hasPms={hasPms} />}
          {activeTab === 'dues' && hasPms && !isHousekeeping && <Dues hotelId={hotel.id} />}
          {activeTab === 'ledger' && hasPms && !isHousekeeping && <Ledger hotelId={hotel.id} />}
          {activeTab === 'contacts' && hasPms && !isHousekeeping && <Contacts hotelId={hotel.id} isOwner={pmsRole === 'owner'} />}
          {activeTab === 'housekeeping' && canManagePms && <HotelTeamStaffPage hotelId={hotel.id} token={token} isOwner={isOwner} />}
          {activeTab === 'reports' && canManagePms && <Reports hotelId={hotel.id} />}
          {(activeTab === 'settings_details' || activeTab === 'settings_brand' || activeTab === 'settings_rooms' || activeTab === 'settings_invoice' || activeTab === 'settings_ledger' || activeTab === 'settings_credentials' || activeTab === 'settings_billing') &&
            canManage && (
              <Onboarding
                hotel={hotel}
                onHotelCreated={setHotel}
                hasPms={hasPms}
                hasChannelManager={hasChannelManager}
                isOwner={isOwner}
                view={
                  activeTab === 'settings_details'
                    ? 'details'
                    : activeTab === 'settings_brand'
                      ? 'brand'
                      : activeTab === 'settings_rooms'
                        ? 'rooms'
                        : activeTab === 'settings_invoice'
                          ? 'invoice'
                          : activeTab === 'settings_ledger'
                            ? 'ledger'
                            : activeTab === 'settings_credentials'
                              ? 'credentials'
                              : 'billing'
                }
              />
            )}
          {activeTab === 'audit_log' && canManage && <AuditLog hotelId={hotel.id} />}
          {activeTab === 'cm_calendar' && canSeeReservations && (
            <Calendar hotelId={hotel.id} onNavigate={setTab} hasChannelManager={hasChannelManager} />
          )}
          {hasChannelManager && !isHousekeeping && (
            <>
              {activeTab === 'cm_guest_messaging' && (
                <GuestMessaging
                  hotelId={hotel.id}
                  initialBookingId={pendingMessageBookingId}
                  onInitialConsumed={() => setPendingMessageBookingId(null)}
                />
              )}
              {activeTab === 'cm_reviews' && (
                <OtaReviews
                  hotelId={hotel.id}
                  onMessageGuest={(bookingId) => {
                    setPendingMessageBookingId(bookingId);
                    setTab('cm_guest_messaging');
                  }}
                />
              )}
              {activeTab === 'cm_rate_inventory_update' && <RateInventoryUpdate hotelId={hotel.id} />}
              {activeTab === 'cm_advance_bulk_update' && <AdvanceBulkUpdate hotelId={hotel.id} />}
              {activeTab === 'cm_inventory' && <Inventory hotelId={hotel.id} />}
              {activeTab === 'cm_channels' && <ConnectedChannels hotelId={hotel.id} />}
              {activeTab === 'cm_reports' && <BusinessReports hotelId={hotel.id} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ThemeProvider>
  );
}
