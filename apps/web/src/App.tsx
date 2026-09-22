import { useEffect, useState } from 'react';
import { query } from './api';
import { AuthProvider, useAuth } from './AuthContext';
import { LoginPanel } from './panels/LoginPanel';
import { Onboarding } from './panels/Onboarding';
import { RoomBoard } from './panels/RoomBoard';
import { RateGrid } from './panels/RateGrid';
import { Bookings } from './panels/Bookings';
import { Housekeeping } from './panels/Housekeeping';
import type { Hotel } from './types';
import './App.css';

type Tab = 'onboarding' | 'rooms' | 'grid' | 'bookings' | 'housekeeping';

function Shell() {
  const { token, user, loading, logout, role } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [tab, setTab] = useState<Tab>('rooms');

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
  if (loading) return <p className="hint">Loading…</p>;

  const pmsRole = role('pms');
  const isHousekeeping = pmsRole === 'housekeeping';
  const canManage = ['owner', 'manager'].includes(pmsRole ?? '');

  return (
    <div className="shell">
      <header>
        <h1>Hotel Platform Simulator</h1>
        <div>
          <span className="hint">
            {user?.userId.slice(0, 8)} · pms: {pmsRole ?? 'none'}
          </span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      {!hotel ? (
        <Onboarding hotel={null} onHotelCreated={setHotel} />
      ) : (
        <>
          <nav className="tabs">
            {canManage && (
              <button className={tab === 'onboarding' ? 'active' : ''} onClick={() => setTab('onboarding')}>
                Onboarding
              </button>
            )}
            <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>
              Room Board
            </button>
            {!isHousekeeping && (
              <button className={tab === 'grid' ? 'active' : ''} onClick={() => setTab('grid')}>
                Rate Grid
              </button>
            )}
            {!isHousekeeping && (
              <button className={tab === 'bookings' ? 'active' : ''} onClick={() => setTab('bookings')}>
                Reservations
              </button>
            )}
            <button className={tab === 'housekeeping' ? 'active' : ''} onClick={() => setTab('housekeeping')}>
              Housekeeping
            </button>
          </nav>

          {tab === 'onboarding' && canManage && <Onboarding hotel={hotel} onHotelCreated={setHotel} />}
          {tab === 'rooms' && <RoomBoard hotelId={hotel.id} />}
          {tab === 'grid' && !isHousekeeping && <RateGrid hotelId={hotel.id} />}
          {tab === 'bookings' && !isHousekeeping && <Bookings hotelId={hotel.id} />}
          {tab === 'housekeeping' && <Housekeeping hotelId={hotel.id} />}
        </>
      )}
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
