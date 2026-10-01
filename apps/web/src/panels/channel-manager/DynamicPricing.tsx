import { useState } from 'react';
import { mutate, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, Field, PageHeader, inputClass } from '../../components/ui';
import { CmFilterBar } from './CmFilterBar';
import { useCmSelection } from './useCmSelection';

const TIERS = [1, 2, 3, 4];

/** §7 Phase 1 #3 — Value Override: a one-time rate float, a genuinely separate write path from Bulk Update (§5.5). */
export function DynamicPricing({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const cm = useCmSelection(hotelId);
  const [date, setDate] = useState(cm.startDate);
  const [occupancyTier, setOccupancyTier] = useState(1);
  const [price, setPrice] = useState(8500);
  const [extraAdultPrice, setExtraAdultPrice] = useState('');
  const [child1Price, setChild1Price] = useState('');
  const [child2Price, setChild2Price] = useState('');
  const [availability, setAvailability] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!cm.ratePlanId || !cm.otaConnectionId) {
      setError('Select a room category, rate plan, and channel above first');
      return;
    }
    try {
      await mutate(
        'rates.setValueOverride',
        {
          ratePlanId: cm.ratePlanId,
          otaConnectionId: cm.otaConnectionId,
          date,
          tiers: [
            {
              occupancyTier,
              price,
              extraAdultPrice: extraAdultPrice ? Number(extraAdultPrice) : undefined,
              child1Price: child1Price ? Number(child1Price) : undefined,
              child2Price: child2Price ? Number(child2Price) : undefined,
              availability,
            },
          ],
        },
        token ?? undefined,
      );
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Value override failed');
    }
  }

  return (
    <div>
      <PageHeader title="Value Override" subtitle="A one-time price float for a specific date — bulk updates skip it until explicitly told to override (§7 Phase 1 #3)." />
      <CmFilterBar cm={cm} showDates={false} />

      <Card>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Date">
                <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Occupancy tier">
                <select className={inputClass} value={occupancyTier} onChange={(e) => setOccupancyTier(Number(e.target.value))}>
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      Tier {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Availability">
                <input className={inputClass} type="number" value={availability} onChange={(e) => setAvailability(Number(e.target.value))} min={0} />
              </Field>
              <Field label="Price">
                <input className={inputClass} type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
              </Field>
              <Field label="+ Adult price">
                <input className={inputClass} type="number" value={extraAdultPrice} onChange={(e) => setExtraAdultPrice(e.target.value)} min={0} placeholder="—" />
              </Field>
              <Field label="Child 1 / Child 2">
                <div className="flex gap-2">
                  <input className={inputClass} type="number" value={child1Price} onChange={(e) => setChild1Price(e.target.value)} min={0} placeholder="Child 1" />
                  <input className={inputClass} type="number" value={child2Price} onChange={(e) => setChild2Price(e.target.value)} min={0} placeholder="Child 2" />
                </div>
              </Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {done && <p className="text-sm text-emerald-600">Override applied.</p>}
            <Button type="submit" variant="secondary">
              Set value override
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
