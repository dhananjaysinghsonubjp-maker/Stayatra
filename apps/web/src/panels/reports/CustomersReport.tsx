import { useEffect, useState } from 'react';
import { assetUrl, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Card, CardBody, EmptyState, PageHeader } from '../../components/ui';
import { formatDateShort } from '../../dateFormat';
import { SOURCE_LABEL } from '../channel-manager/ota-labels';

interface CustomersData {
  totalGuests: number;
  newGuests: number;
  repeatGuests: number;
  repeatRatePercent: number;
  loyaltyMembers: number;
  activeGuests: number;
  directGuestShare: { direct: number; ota: number; percent: number };
  monthlyGrowth: { month: string; new: number; repeat: number }[];
  guestLocations: { state: { name: string; count: number; percent: number }[]; country: { name: string; count: number; percent: number }[]; city: { name: string; count: number; percent: number }[] };
  guestsWithState: number;
  ageGroups: { name: string; count: number; percent: number }[];
  guestsWithAge: number;
  repeatAgeGroups: { name: string; count: number; percent: number }[];
  topCustomers: { id: string; name: string; phone: string; bookings: number; totalSpend: number }[];
  combinedSpend: number;
  vipCount: number;
  vipBreakdown: { tier: string; threshold: string; count: number; percent: number }[];
  addressOnFilePercent: number;
  ageOnFilePercent: number;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * §user request, with a reference app's own guest-analytics dashboard as the target — guest
 * growth, demographics, top customers ranked by spend, and VIP tiering by booking count.
 * Clicking a Top Customer opens their own full profile (CustomerProfile below) in place, same
 * "lift a selected id into local state" pattern used all over this app for list → detail views.
 * A Loyalty Program (Hotel Membership) is explicitly future work per the user's own request —
 * not built here; "Loyalty members" below is just today's repeat-guest count standing in for it.
 */
export function CustomersReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [data, setData] = useState<CustomersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationTab, setLocationTab] = useState<'country' | 'state' | 'city'>('state');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      setData(await query<CustomersData>('reports.customers', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load customers');
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  if (selectedGuestId) {
    return <CustomerProfile hotelId={hotelId} guestId={selectedGuestId} onBack={() => setSelectedGuestId(null)} />;
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const maxMonthly = Math.max(1, ...data.monthlyGrowth.map((m) => m.new + m.repeat));
  const locationRows = data.guestLocations[locationTab];

  return (
    <div>
      <PageHeader title="Customers" subtitle="Guest growth, demographics, and your top spenders" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guests</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.totalGuests}</p>
          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <span>New {data.newGuests}</span>
            <span>Repeat {data.repeatGuests}</span>
          </div>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Repeat Rate</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.repeatRatePercent.toFixed(1)}%</p>
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">Loyalty members {data.loyaltyMembers}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Direct Guest Share</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.directGuestShare.percent.toFixed(1)}%</p>
          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <span>Direct {data.directGuestShare.direct}</span>
            <span>OTA {data.directGuestShare.ota}</span>
          </div>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Active Guests</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.activeGuests}</p>
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">Stayed in the last 90 days</p>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">New vs Repeat Guests</p>
            <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">New and returning guests, by the month they booked</p>
            {data.monthlyGrowth.length === 0 ? (
              <EmptyState title="No bookings yet" />
            ) : (
              <div className="flex h-40 items-end gap-2">
                {data.monthlyGrowth.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-32 w-full flex-col justify-end overflow-hidden rounded-t-md bg-slate-50 dark:bg-slate-900/40">
                      {m.repeat > 0 && <div className="w-full bg-violet-400" style={{ height: `${(m.repeat / maxMonthly) * 100}%` }} title={`Repeat: ${m.repeat}`} />}
                      {m.new > 0 && <div className="w-full bg-emerald-400" style={{ height: `${(m.new / maxMonthly) * 100}%` }} title={`New: ${m.new}`} />}
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{monthLabel(m.month)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> New
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-400" /> Repeat
              </span>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guest Summary</p>
            <div className="space-y-2.5 text-sm">
              {[
                ['Total guests', data.totalGuests],
                ['New', `${data.newGuests}`],
                ['Repeat', `${data.repeatGuests}`],
                ['Active guests', data.activeGuests],
                ['Loyalty members', data.loyaltyMembers],
                ['Address on file', `${data.guestsWithState} (${data.addressOnFilePercent.toFixed(1)}%)`],
                ['Age on file', `${data.guestsWithAge} (${data.ageOnFilePercent.toFixed(1)}%)`],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center justify-between border-b border-slate-50 pb-2 last:border-0 dark:border-slate-700/60">
                  <span className="text-slate-500 dark:text-slate-400">{label}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{value}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardBody>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guest Locations</p>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px] dark:bg-slate-700">
                {(['country', 'state', 'city'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLocationTab(t)}
                    className={`rounded-md px-2 py-1 font-medium capitalize transition-colors ${locationTab === t ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">{data.guestsWithState} guests with a state on file</p>
            {locationRows.length === 0 ? (
              <EmptyState title="No location data yet" />
            ) : (
              <div className="space-y-2.5">
                {locationRows.slice(0, 6).map((r) => (
                  <div key={r.name}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
                      <span className="text-slate-400 dark:text-slate-500">
                        {r.count} · {r.percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${r.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guests by Age Group</p>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">{data.guestsWithAge} guests with age on file</p>
            {data.ageGroups.length === 0 ? (
              <EmptyState title="No age data yet" />
            ) : (
              <div className="space-y-2.5">
                {data.ageGroups.map((r) => (
                  <div key={r.name}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
                      <span className="text-slate-400 dark:text-slate-500">
                        {r.count} ({r.percent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${r.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Repeat Guests by Age Group</p>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
              {data.repeatRatePercent.toFixed(1)}% repeat rate ({data.repeatGuests} of {data.totalGuests} guests)
            </p>
            {data.repeatAgeGroups.length === 0 ? (
              <EmptyState title="No repeat guests yet" />
            ) : (
              <div className="space-y-2.5">
                {data.repeatAgeGroups.map((r) => (
                  <div key={r.name}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
                      <span className="text-slate-400 dark:text-slate-500">
                        {r.count} ({r.percent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-sky-400" style={{ width: `${r.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardBody>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Top 10 Customers</p>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">₹{data.combinedSpend.toLocaleString('en-IN')} combined spend</p>
          </CardBody>
          {data.topCustomers.length === 0 ? (
            <CardBody>
              <EmptyState title="No bookings yet" />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                    <th className="px-5 py-2.5">Customer</th>
                    <th className="px-5 py-2.5">Phone</th>
                    <th className="px-5 py-2.5 text-right">Bookings</th>
                    <th className="px-5 py-2.5 text-right">Total spend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {data.topCustomers.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40" onClick={() => setSelectedGuestId(c.id)}>
                      <td className="px-5 py-3 font-medium text-brand-600 hover:underline dark:text-brand-400">{c.name}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{c.phone}</td>
                      <td className="px-5 py-3 text-right">{c.bookings}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900 dark:text-white">₹{c.totalSpend.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardBody>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">VIP Guests</p>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
              {data.vipCount} VIP of {data.totalGuests} guests
            </p>
            <div className="space-y-3">
              {data.vipBreakdown.map((t) => (
                <div key={t.tier}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{t.tier}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {t.count} · {t.percent.toFixed(1)}%
                    </span>
                  </div>
                  <p className="mb-1 text-[11px] text-slate-400 dark:text-slate-500">{t.threshold}</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${t.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

interface CustomerProfileData {
  guest: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    address: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    pincode: string | null;
    idType: string | null;
    idNumber: string | null;
    idPhotoPath: string | null;
    idPhotoBackPath: string | null;
  };
  totalBookings: number;
  totalSpend: number;
  rank: number;
  totalGuests: number;
  vipTier: string;
  bookings: { id: string; bookingCode: string; checkIn: string; checkOut: string; roomNumber: string | null; status: string; source: string; amount: number }[];
}

function CustomerProfile({ hotelId, guestId, onBack }: { hotelId: string; guestId: string; onBack: () => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<CustomerProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    query<CustomerProfileData>('reports.customerProfile', { hotelId, guestId }, token ?? undefined)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load guest profile'));
  }, [hotelId, guestId, token]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const { guest } = data;
  const addressParts = [guest.address, guest.city, guest.state, guest.pincode, guest.country].filter(Boolean);

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
        ← Back to Customers
      </button>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{guest.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{guest.phone}</p>
        </div>
        <Badge tone={data.vipTier === 'Regular' ? 'slate' : 'flagged'}>{data.vipTier}</Badge>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Bookings</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.totalBookings}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Spend</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">₹{data.totalSpend.toLocaleString('en-IN')}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Rank</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
            #{data.rank} <span className="text-sm font-normal text-slate-400">of {data.totalGuests}</span>
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">VIP Tier</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.vipTier}</p>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guest Information</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Email</span>
                <span className="font-medium text-slate-900 dark:text-white">{guest.email ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Gender</span>
                <span className="font-medium text-slate-900 dark:text-white">{guest.gender ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Date of birth</span>
                <span className="font-medium text-slate-900 dark:text-white">{guest.dateOfBirth ? formatDateShort(guest.dateOfBirth) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Address</span>
                <span className="max-w-[60%] text-right font-medium text-slate-900 dark:text-white">{addressParts.length > 0 ? addressParts.join(', ') : '—'}</span>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            {/* §user request — "uska Aadhaar card bhi automatically usme lag jaega check-in ke
                time": the ID this guest's profile already has on file (captured at an earlier
                check-in), shown here rather than needing to re-scan it. */}
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guest ID</p>
            {guest.idType ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">ID Type</span>
                  <span className="font-medium capitalize text-slate-900 dark:text-white">{guest.idType.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">ID Number</span>
                  <span className="font-medium text-slate-900 dark:text-white">{guest.idNumber ?? '—'}</span>
                </div>
                <div className="mt-3 flex gap-3">
                  {guest.idPhotoPath && (
                    <a href={assetUrl(guest.idPhotoPath)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                      View front
                    </a>
                  )}
                  {guest.idPhotoBackPath && (
                    <a href={assetUrl(guest.idPhotoBackPath)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                      View back
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 dark:text-slate-500">No ID on file yet — captured automatically at their next check-in.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardBody>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Booking History</p>
        </CardBody>
        {data.bookings.length === 0 ? (
          <CardBody>
            <EmptyState title="No bookings yet" />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-5 py-2.5">Booking</th>
                  <th className="px-5 py-2.5">Check-in</th>
                  <th className="px-5 py-2.5">Check-out</th>
                  <th className="px-5 py-2.5">Room</th>
                  <th className="px-5 py-2.5">Source</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-5 py-3 font-bold text-slate-900 dark:text-white">{b.bookingCode}</td>
                    <td className="px-5 py-3">{formatDateShort(b.checkIn)}</td>
                    <td className="px-5 py-3">{formatDateShort(b.checkOut)}</td>
                    <td className="px-5 py-3">{b.roomNumber ?? '—'}</td>
                    <td className="px-5 py-3">{SOURCE_LABEL[b.source] ?? b.source}</td>
                    <td className="px-5 py-3">
                      <Badge tone={b.status}>{b.status.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">₹{b.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
