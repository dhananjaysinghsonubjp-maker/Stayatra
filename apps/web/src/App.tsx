import { useEffect, useState } from 'react';
import { query } from './api';
import { AuthProvider, useAuth } from './AuthContext';
import { LoginPanel } from './panels/LoginPanel';
import { Dashboard } from './panels/Dashboard';
import { Onboarding } from './panels/Onboarding';
import { RoomBoard } from './panels/RoomBoard';
import { InHouse } from './panels/InHouse';
import { RateGrid } from './panels/RateGrid';
import { Bookings } from './panels/Bookings';
import { Dues } from './panels/Dues';
import { Housekeeping } from './panels/Housekeeping';
import { Reports } from './panels/Reports';
import { Sidebar, type Tab } from './layout/Sidebar';
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
  const isHousekeeping = pmsRole === 'housekeeping';
  const canManage = ['owner', 'manager'].includes(pmsRole ?? '');

  if (!hotel) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl px-4 py-12">
          <Onboarding hotel={null} onHotelCreated={setHotel} />
        </div>
      </div>
    );
  }

  const visibleTabs: Tab[] = [
    'dashboard',
    'rooms',
    ...(!isHousekeeping ? (['inhouse', 'bookings', 'dues', 'grid'] as Tab[]) : []),
    'housekeeping',
    ...(canManage ? (['reports', 'setup'] as Tab[]) : []),
  ];

  const roleLabel = pmsRole ? pmsRole.replace('_', ' ') : 'no role';

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
        <div className="mx-auto max-w-6xl px-8 py-8">
          {tab === 'dashboard' && <Dashboard hotelId={hotel.id} onNavigate={setTab} />}
          {tab === 'rooms' && <RoomBoard hotelId={hotel.id} />}
          {tab === 'inhouse' && !isHousekeeping && <InHouse hotelId={hotel.id} />}
          {tab === 'grid' && !isHousekeeping && <RateGrid hotelId={hotel.id} />}
          {tab === 'bookings' && !isHousekeeping && <Bookings hotelId={hotel.id} />}
          {tab === 'dues' && !isHousekeeping && <Dues hotelId={hotel.id} />}
          {tab === 'housekeeping' && <Housekeeping hotelId={hotel.id} />}
          {tab === 'reports' && canManage && <Reports hotelId={hotel.id} />}
          {tab === 'setup' && canManage && <Onboarding hotel={hotel} onHotelCreated={setHotel} />}
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
