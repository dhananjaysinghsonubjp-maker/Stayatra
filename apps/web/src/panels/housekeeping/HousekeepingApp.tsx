import { useEffect, useMemo, useState } from 'react';
import { assetUrl, query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, EmptyState } from '../../components/ui';
import { istDateKey, istDateLabel, DateFilterPill } from '../../components/DateRangePicker';
import { isColorDark } from '../../brandColor';
import { CleaningWizard } from '../Housekeeping';
import type { CleaningRecord, HousekeeperOption, Hotel, MyStaffProfile, Room } from '../../types';

/**
 * §user request, with actual Skymax app screenshots as the reference — housekeeping's whole
 * experience there is a 3-tab native app (Rooms / My History / Profile), not a page inside the
 * same sidebar every other role uses. This is that same shape, rendered instead of the normal
 * Shell for anyone whose pms role is 'housekeeping' (see App.tsx).
 */

type HkTab = 'rooms' | 'history' | 'profile';

/** India-first (§ same fixed UTC+5:30 reasoning as Dashboard.tsx's getIstHour) — a cleaning
 * logged at, say, 20:21 UTC is 01:51 IST the NEXT calendar day. Using the browser's own local
 * timezone (or a raw UTC slice) to decide "which day" a record belongs to gave a different
 * answer than IST whenever the device isn't itself set to IST, so this is computed with a fixed
 * offset instead — exact regardless of device locale. */
function istTimeLabel(iso: string): string {
  const istMs = new Date(iso).getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  let hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const suffix = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function BedIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18v2M3 18h18m0 0v2M5 10V6a2 2 0 012-2h3M11 10V7a1 1 0 011-1h5a2 2 0 012 2v2" />
    </svg>
  );
}
function ClockIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

const TAB_LABEL: Record<HkTab, string> = { rooms: 'Rooms', history: 'My History', profile: 'Profile' };

function TabBarButton({ tab, active, onClick }: { tab: HkTab; active: boolean; onClick: () => void }) {
  const tone = active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500';
  return (
    <button onClick={onClick} className={`flex flex-1 flex-col items-center gap-1 py-2.5 ${tone}`}>
      <span className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${active ? 'bg-brand-50 dark:bg-brand-500/15' : ''}`}>
        {tab === 'rooms' && <BedIcon active={active} />}
        {tab === 'history' && <ClockIcon active={active} />}
        {tab === 'profile' && <ProfileIcon active={active} />}
      </span>
      <span className={`text-[11px] ${active ? 'font-bold' : 'font-medium'}`}>{TAB_LABEL[tab]}</span>
    </button>
  );
}

/** §user request — "header mein company ki details bhi mention ho jaegi and brand bhi": every
 * Skymax owner/housekeeping screen carries the hotel's own brand as its header (logo/wordmark,
 * brand colour), so the screen title is dropped here too — the bottom tab bar already labels
 * which screen is active, a second label would be redundant (same reasoning as the reference). */
function BrandHeader({ hotel }: { hotel: Hotel }) {
  const tone: 'light' | 'dark' = isColorDark(hotel.brandColor) ? 'light' : 'dark';
  const textClass = tone === 'light' ? 'text-white' : 'text-slate-900';
  const subTextClass = tone === 'light' ? 'text-white/70' : 'text-slate-900/60';
  return (
    <div className="flex items-center gap-3 bg-brand-600 px-4 py-3.5">
      {hotel.logoFilePath ? (
        <img src={assetUrl(hotel.logoFilePath)} alt={hotel.name} className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-white/30" />
      ) : (
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-base font-bold ${textClass}`}>
          {hotel.name[0]?.toUpperCase() ?? 'H'}
        </div>
      )}
      <div className="min-w-0">
        <p className={`truncate text-sm font-bold ${textClass}`}>{hotel.name}</p>
        <p className={`truncate text-[11px] ${subTextClass}`}>Property ID: {hotel.shortCode}</p>
      </div>
    </div>
  );
}

function ScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center py-20">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-slate-700 dark:border-t-brand-400" />
    </div>
  );
}

function RoomsView({ hotelId, refreshKey, onSubmitted }: { hotelId: string; refreshKey: number; onSubmitted: () => void }) {
  const { token, user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<HousekeeperOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [r, h] = await Promise.all([
        query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
        query<HousekeeperOption[]>('cleaning.listHousekeepers', { hotelId }, token ?? undefined),
      ]);
      if (cancelled) return;
      setRooms(r);
      setHousekeepers(h);
      setLoading(false);
    }
    void load();
    // §user request — "koi cheez chhoot toh nahi rahi": every other room-status screen in the
    // app polls (RoomBoard/Dashboard/owner's Housekeeping), this one didn't — a room the FMO just
    // checked out stayed invisible here until the housekeeper happened to switch tabs and back.
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hotelId, token, refreshKey]);

  const selfName = housekeepers.find((h) => h.id === user?.userId)?.name ?? 'You';

  if (loading) return <ScreenSpinner />;

  return (
    <div className="p-4">
      <CleaningWizard
        hotelId={hotelId}
        rooms={rooms}
        housekeepers={housekeepers}
        selfId={user?.userId}
        selfName={selfName}
        onSubmitted={onSubmitted}
        bare
      />
    </div>
  );
}

/** §user request — a date filter to see when a housekeeping boy worked and which rooms he
 * cleaned that day, and a per-record detail (tap a room) showing cleaning time, the second
 * helper, and the uploaded photos. Housekeeping-app only — this never reaches the owner/FMO
 * view of Housekeeping (Housekeeping.tsx), which is a separate component. */
function RecordDetail({
  record,
  roomNumber,
  partnerName,
  onBack,
}: {
  record: CleaningRecord;
  roomNumber: string;
  partnerName: string | undefined;
  onBack: () => void;
}) {
  return (
    <div className="p-4">
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
        ← Back
      </button>
      <h2 className="text-xl font-bold text-slate-900 dark:text-white">Room {roomNumber}</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {record.kind === 'guest_stay' ? 'Guest Cleaning' : 'Checkout Cleaning'}
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">Cleaning done at</span>
          <span className="text-xs font-bold text-slate-900 dark:text-white">
            {istDateLabel(istDateKey(record.createdAt))} · {istTimeLabel(record.createdAt)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-50 py-1.5 dark:border-slate-700/60">
          <span className="text-xs text-slate-500 dark:text-slate-400">Second helper</span>
          <span className="text-xs font-bold text-slate-900 dark:text-white">{partnerName ?? 'None'}</span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-50 py-1.5 dark:border-slate-700/60">
          <span className="text-xs text-slate-500 dark:text-slate-400">Photos uploaded</span>
          <span className="text-xs font-bold text-slate-900 dark:text-white">{record.photos.length}</span>
        </div>
      </div>

      <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Photos</p>
      <div className="flex flex-wrap gap-3">
        {record.photos.map((photo, i) => (
          <img
            key={photo}
            src={assetUrl(photo)}
            alt={`Evidence ${i + 1}`}
            className="h-24 w-24 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
          />
        ))}
      </div>
    </div>
  );
}

function MyHistoryView({ hotelId, refreshKey }: { hotelId: string; refreshKey: number }) {
  const { token, user } = useAuth();
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<HousekeeperOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDates, setSelectedDates] = useState<string[]>(() => [istDateKey(new Date().toISOString())]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [c, r, h] = await Promise.all([
        query<CleaningRecord[]>('cleaning.list', { hotelId }, token ?? undefined),
        query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
        query<HousekeeperOption[]>('cleaning.listHousekeepers', { hotelId }, token ?? undefined),
      ]);
      if (cancelled) return;
      setRecords(c);
      setRooms(r);
      setHousekeepers(h);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [hotelId, token, refreshKey]);

  // §user request — "14, 15, 16 select karu toh properly dates ke filter ke saath [grouped]
  // dikhe": multiple individual dates, each its own group of rooms cleaned that day.
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const matching = useMemo(
    () =>
      records
        .filter((r) => r.primaryHousekeeperId === user?.userId || r.secondHousekeeperId === user?.userId)
        .filter((r) => selectedSet.has(istDateKey(r.createdAt)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records, user?.userId, selectedSet],
  );

  const groups = useMemo(() => {
    const byDate = new Map<string, CleaningRecord[]>();
    for (const item of matching) {
      const dateKey = istDateKey(item.createdAt);
      const list = byDate.get(dateKey) ?? [];
      list.push(item);
      byDate.set(dateKey, list);
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])); // newest date first
  }, [matching]);

  function partnerFor(item: CleaningRecord) {
    const partnerId = item.primaryHousekeeperId === user?.userId ? item.secondHousekeeperId : item.primaryHousekeeperId;
    return housekeepers.find((h) => h.id === partnerId)?.name;
  }
  function roomNumberFor(item: CleaningRecord) {
    return rooms.find((r) => r.id === item.roomId)?.roomNumber ?? item.roomId;
  }

  if (loading) return <ScreenSpinner />;

  const selectedRecord = selectedId ? matching.find((r) => r.id === selectedId) : null;
  if (selectedRecord) {
    return (
      <RecordDetail
        record={selectedRecord}
        roomNumber={roomNumberFor(selectedRecord)}
        partnerName={partnerFor(selectedRecord)}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="p-4">
      <h2 className="mb-3 text-xl font-bold text-slate-900 dark:text-white">My Cleaning History</h2>

      <div className="mb-4">
        <DateFilterPill selected={selectedDates} onChange={setSelectedDates} />
      </div>

      {matching.length === 0 ? (
        <EmptyState title="No cleanings on the selected date(s)." />
      ) : (
        <div className="space-y-5">
          {groups.map(([dateKey, items]) => (
            <div key={dateKey}>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-bold text-slate-900 dark:text-white">{istDateLabel(dateKey)}</p>
                <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                  {items.length} room{items.length === 1 ? '' : 's'} cleaned
                </p>
              </div>
              <div className="space-y-2">
                {items.map((item) => {
                  const partnerName = partnerFor(item);
                  const roomNumber = roomNumberFor(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition-shadow hover:shadow dark:border-slate-700 dark:bg-slate-800"
                    >
                      <p className="text-base font-bold text-slate-900 dark:text-white">Room {roomNumber}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {item.kind === 'guest_stay' ? 'Guest Cleaning · ' : ''}
                        {partnerName ? `with ${partnerName} · ` : ''}
                        {istTimeLabel(item.createdAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** §user request — "uski photo show nahi ho rahi hai and uski details bhi": this used to just
 * show an initial-letter avatar, since it only ever had the housekeeper-list lookup to go on
 * (no photo there). Now fetches the real self-profile (photo/phone/designation) via
 * `staff.myProfile`, the one query any logged-in staff member can call for their own record. */
function ProfileView({ hotel, token, onLogout }: { hotel: Hotel; token: string | null; onLogout: () => void }) {
  const [profile, setProfile] = useState<MyStaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void query<MyStaffProfile>('staff.myProfile', undefined, token ?? undefined).then((p) => {
      if (cancelled) return;
      setProfile(p);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) return <ScreenSpinner />;

  const name = profile?.name ?? '…';

  return (
    <div className="flex h-full flex-col items-center justify-between p-6">
      <div className="mt-10 flex flex-col items-center">
        {profile?.photoPath ? (
          <img src={assetUrl(profile.photoPath)} alt={name} className="h-20 w-20 rounded-full object-cover shadow-sm ring-1 ring-slate-200 dark:ring-slate-600" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-bold text-white shadow-sm">
            {name[0]?.toUpperCase() ?? 'H'}
          </div>
        )}
        <p className="mt-3 text-lg font-bold text-slate-900 dark:text-white">{name}</p>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{profile?.designation ?? 'Housekeeping'}</p>
        {profile?.shift && (
          <span className="mt-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            {profile.shift}
          </span>
        )}
        {profile?.phone && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{profile.phone}</p>}
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">{hotel.name} · ID: {hotel.shortCode}</p>
      </div>
      <Button variant="secondary" className="w-full" onClick={onLogout}>
        Log Out
      </Button>
    </div>
  );
}

export function HousekeepingApp({ hotel, onLogout }: { hotel: Hotel; onLogout: () => void }) {
  const { token } = useAuth();
  const [tab, setTab] = useState<HkTab>('rooms');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-screen flex-col bg-slate-50 dark:bg-slate-900">
      <BrandHeader hotel={hotel} />
      <main className="flex-1 overflow-y-auto">
        {tab === 'rooms' && <RoomsView hotelId={hotel.id} refreshKey={refreshKey} onSubmitted={() => setRefreshKey((k) => k + 1)} />}
        {tab === 'history' && <MyHistoryView hotelId={hotel.id} refreshKey={refreshKey} />}
        {tab === 'profile' && <ProfileView hotel={hotel} token={token} onLogout={onLogout} />}
      </main>
      <nav className="flex border-t border-slate-200 bg-white shadow-[0_-1px_8px_rgba(0,0,0,0.04)] dark:border-slate-700 dark:bg-slate-900">
        <TabBarButton tab="rooms" active={tab === 'rooms'} onClick={() => setTab('rooms')} />
        <TabBarButton tab="history" active={tab === 'history'} onClick={() => setTab('history')} />
        <TabBarButton tab="profile" active={tab === 'profile'} onClick={() => setTab('profile')} />
      </nav>
    </div>
  );
}
