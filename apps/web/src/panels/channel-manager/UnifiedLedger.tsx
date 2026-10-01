import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Card, CardBody, CardHeader, Field, PageHeader, StatCard, inputClass } from '../../components/ui';
import { ChannelBadge } from './ChannelBadge';
import { computeCmStats } from './cmStats';
import type { Booking, OtaConnection } from '../../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

const ECOMMERCE_TDS_RATE = 0.001; // Section 194-O, 0.1%
const COMMISSION_TDS_RATE = 0.02; // Section 393(1), code 1006, 2% — per MASTER_SPEC.md §11

interface BillingStatus {
  planName: string;
  priceMonthly: string;
  effectiveStatus: string;
}

/**
 * §6 — "one screen answering where does our money actually go," built entirely from bookings,
 * connections, and billing status that already exist elsewhere. Read-only rollup: nothing here is
 * ever edited directly — a wrong number is a bug in the table that produced it, not something to
 * fix on this screen (§6's own design rule).
 */
export function UnifiedLedger({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [startDate, setStartDate] = useState(todayPlus(-30));
  const [endDate, setEndDate] = useState(todayPlus(30));

  useEffect(() => {
    async function load() {
      const [b, c, bill] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId, from: startDate, to: endDate }, token ?? undefined),
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
        query<BillingStatus>('billing.getStatus', undefined, token ?? undefined),
      ]);
      setBookings(b);
      setConnections(c);
      setBilling(bill);
    }
    void load();
  }, [hotelId, token, startDate, endDate]);

  const stats = computeCmStats(bookings);

  const byChannel = connections.map((c) => {
    const rows = bookings.filter((b) => b.source === c.otaCode);
    const s = computeCmStats(rows);
    const commissionRate = c.commissionRatePercent ? Number(c.commissionRatePercent) : 0;
    const commissionAmount = s.totalSale * (commissionRate / 100);
    const ecommerceTds = s.totalSale * ECOMMERCE_TDS_RATE;
    const commissionTds = commissionAmount * COMMISSION_TDS_RATE;
    const netPayout = s.totalSale - commissionAmount - ecommerceTds - commissionTds;
    return { connection: c, gross: s.totalSale, commissionAmount, ecommerceTds, commissionTds, netPayout };
  });

  const totalGross = byChannel.reduce((sum, r) => sum + r.gross, 0);
  const totalCommission = byChannel.reduce((sum, r) => sum + r.commissionAmount, 0);
  const totalTds = byChannel.reduce((sum, r) => sum + r.ecommerceTds + r.commissionTds, 0);
  const totalNetFromChannels = byChannel.reduce((sum, r) => sum + r.netPayout, 0);
  const directAndWalkIn = stats.totalSale - totalGross;
  const subscriptionCost = billing ? Number(billing.priceMonthly) : 0;
  const bottomLine = totalNetFromChannels + directAndWalkIn - subscriptionCost;

  return (
    <div>
      <PageHeader title="Unified Ledger" subtitle="Where the money actually goes — guest revenue, channel commission, tax withholding, and what we charge you, in one place." />

      <Card className="mb-6">
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="From">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Guest revenue (gross)" value={`₹${stats.totalSale.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone="brand" />
        <StatCard label="Commission + TDS" value={`₹${(totalCommission + totalTds).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone="amber" />
        <StatCard label="Platform subscription" value={billing ? `₹${subscriptionCost.toLocaleString('en-IN')}` : '—'} />
        <StatCard label="Net to you" value={`₹${bottomLine.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone={bottomLine >= 0 ? 'brand' : 'red'} />
      </div>

      {byChannel.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="Channel payouts, net of tax withholding"
            subtitle="E-commerce TDS (0.1%, Sec 194-O) and commission TDS (2%, Sec 393(1)) — estimated; confirm exact treatment with your CA before relying on this for filing."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3">Gross sale</th>
                  <th className="px-5 py-3">Commission</th>
                  <th className="px-5 py-3">E-comm TDS (0.1%)</th>
                  <th className="px-5 py-3">Commission TDS (2%)</th>
                  <th className="px-5 py-3">Net payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byChannel.map((row) => (
                  <tr key={row.connection.id}>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      <ChannelBadge source={row.connection.otaCode} />
                    </td>
                    <td className="px-5 py-3 text-slate-900">₹{row.gross.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-3 text-amber-600">−₹{row.commissionAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-3 text-amber-600">−₹{row.ecommerceTds.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-3 text-amber-600">−₹{row.commissionTds.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">₹{row.netPayout.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Bottom line" />
        <CardBody className="space-y-2 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Net from OTA channels</span>
            <span>₹{totalNetFromChannels.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Direct + walk-in revenue (no commission)</span>
            <span>₹{directAndWalkIn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Platform subscription ({billing?.planName ?? '—'})</span>
            <span>−₹{subscriptionCost.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
            <span>Net to you</span>
            <span>₹{bottomLine.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
