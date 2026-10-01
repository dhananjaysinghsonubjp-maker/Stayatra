import { useEffect, useState } from 'react';
import { query } from './api';
import { AuthProvider, useAuth } from './AuthContext';
import { LoginPanel } from './panels/LoginPanel';
import { Dashboard } from './panels/Dashboard';
import { Onboarding } from './panels/Onboarding';
import { RoomBoard } from './panels/RoomBoard';
import { InHouse } from './panels/InHouse';
import { Bookings } from './panels/Bookings';
import { Dues } from './panels/Dues';
import { Housekeeping } from './panels/Housekeeping';
import { Reports } from './panels/Reports';
import { Calendar } from './panels/channel-manager/Calendar';
import { RateUpdate } from './panels/channel-manager/RateUpdate';
import { InventoryUpdate } from './panels/channel-manager/InventoryUpdate';
import { Restrictions } from './panels/channel-manager/Restrictions';
import { DynamicPricing } from './panels/channel-manager/DynamicPricing';
import { RatePlans } from './panels/channel-manager/RatePlans';
import { Inventory } from './panels/channel-manager/Inventory';
import { ConnectedChannels } from './panels/channel-manager/ConnectedChannels';
import { Credentials } from './panels/channel-manager/Credentials';
import { BusinessReports } from './panels/channel-manager/BusinessReports';
import { Billing } from './panels/Billing';
import { AuditLog } from './panels/AuditLog';
import { UnifiedLedger } from './panels/channel-manager/UnifiedLedger';
import { Sidebar, type Tab } from './layout/Sidebar';
import { NotificationBell } from './components/NotificationBell';
import { SubscriptionBanner } from './components/SubscriptionBanner';
import type { Hotel } from './types';

function Shell() {
  const { token, user, loading, logout, role } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => {
    if (!user) return;
    if (user.hotelId) {
      query<Hotel>('hotels.get', { hotelId: user.hotelId }, token ?? undefined).then(setHotel);
    } else {
      query<Hotel[]>('hotels.list', undefined, token ?? undefined).then((hotels) => {
        if (hotels[0]) setHotel(hotels[0]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!token) return <LoginPanel />;
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">Loading…</div>
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
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl px-4 py-12">
          <Onboarding hotel={null} onHotelCreated={setHotel} hasPms={hasPms} />
        </div>
      </div>
    );
  }

  // Reservations (§7 Phase 1 #5) is Channel-Manager content, not PMS-only —
  // a CM-only org has bookings pulled from its connected channels even with
  // no physical rooms/front desk at all, so it must see this tab too.
  const canSeeReservations = (hasPms || hasChannelManager) && !isHousekeeping;

  const cmTabs: Tab[] = [
    'cm_rate_update',
    'cm_inventory_update',
    'cm_calendar',
    'cm_restrictions',
    'cm_dynamic_pricing',
    'cm_rate_plans',
    'cm_reports',
    'cm_ledger',
    'cm_channels',
    'cm_inventory',
    'cm_credentials',
  ];

  const visibleTabs: Tab[] = [
    'dashboard',
    ...((hasPms ? ['rooms'] : []) as Tab[]),
    ...((hasPms && !isHousekeeping ? ['inhouse'] : []) as Tab[]),
    ...((canSeeReservations ? ['bookings'] : []) as Tab[]),
    ...((hasPms && !isHousekeeping ? ['dues'] : []) as Tab[]),
    ...((hasChannelManager && !isHousekeeping ? cmTabs : []) as Tab[]),
    ...((hasPms ? ['housekeeping'] : []) as Tab[]),
    // Reports is entirely PMS-shaped content (rooms/sales/housekeeping) and
    // its endpoints are PMS-role-gated server-side — a Channel-Manager-only
    // owner would just hit FORBIDDEN on every query, so this stays on the
    // narrower PMS check while Setup (which also covers shared Room
    // Categories) stays on the broader either-module check.
    ...(canManagePms ? (['reports'] as Tab[]) : []),
    ...(canManage ? (['setup'] as Tab[]) : []),
    ...(canManage ? (['audit_log'] as Tab[]) : []),
    ...(isOwner ? (['billing'] as Tab[]) : []),
  ];

  const roleLabel = (pmsRole ?? cmRole)?.replace('_', ' ') ?? 'no role';

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar
        hotel={hotel}
        tab={tab}
        onTab={setTab}
        visibleTabs={visibleTabs}
        userLabel={user?.userId.slice(0, 10) ?? ''}
        roleLabel={roleLabel}
        onLogout={logout}
      />
      <main className="flex-1 overflow-y-auto">
        {isOwner && <SubscriptionBanner onNavigate={setTab} />}
        <div className="flex justify-end border-b border-slate-100 bg-white px-8 py-2.5">
          <NotificationBell hotelId={hotel.id} onNavigate={setTab} />
        </div>
        <div className="mx-auto max-w-6xl px-8 py-8">
          {tab === 'dashboard' && <Dashboard hotelId={hotel.id} onNavigate={setTab} hasPms={hasPms} hasChannelManager={hasChannelManager} />}
          {tab === 'rooms' && hasPms && <RoomBoard hotelId={hotel.id} />}
          {tab === 'inhouse' && hasPms && !isHousekeeping && <InHouse hotelId={hotel.id} />}
          {tab === 'bookings' && canSeeReservations && <Bookings hotelId={hotel.id} hasPms={hasPms} />}
          {tab === 'dues' && hasPms && !isHousekeeping && <Dues hotelId={hotel.id} />}
          {tab === 'housekeeping' && hasPms && <Housekeeping hotelId={hotel.id} />}
          {tab === 'reports' && canManagePms && <Reports hotelId={hotel.id} />}
          {tab === 'setup' && canManage && <Onboarding hotel={hotel} onHotelCreated={setHotel} hasPms={hasPms} />}
          {tab === 'audit_log' && canManage && <AuditLog hotelId={hotel.id} />}
          {tab === 'billing' && isOwner && <Billing />}
          {hasChannelManager && !isHousekeeping && (
            <>
              {tab === 'cm_calendar' && <Calendar hotelId={hotel.id} />}
              {tab === 'cm_rate_update' && <RateUpdate hotelId={hotel.id} />}
              {tab === 'cm_inventory_update' && <InventoryUpdate hotelId={hotel.id} />}
              {tab === 'cm_restrictions' && <Restrictions hotelId={hotel.id} />}
              {tab === 'cm_dynamic_pricing' && <DynamicPricing hotelId={hotel.id} />}
              {tab === 'cm_rate_plans' && <RatePlans hotelId={hotel.id} />}
              {tab === 'cm_inventory' && <Inventory hotelId={hotel.id} />}
              {tab === 'cm_channels' && <ConnectedChannels hotelId={hotel.id} />}
              {tab === 'cm_credentials' && <Credentials hotelId={hotel.id} />}
              {tab === 'cm_reports' && <BusinessReports hotelId={hotel.id} />}
              {tab === 'cm_ledger' && <UnifiedLedger hotelId={hotel.id} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
