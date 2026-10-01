import { useState } from 'react';
import { mutate, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../../components/ui';
import { useCmSelection } from './useCmSelection';

/**
 * "Linked Rate Plan" — rate-plan CRUD, plus derived/BAR pricing (§5.5's
 * is_derived_value + rate_plans.formula design; §10 flags this as needing
 * "its own guided onboarding moment" — this is that moment, not a bare form
 * buried in Bulk Update).
 */
export function RatePlans({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const cm = useCmSelection(hotelId);
  const [name, setName] = useState('');
  const [mealPlan, setMealPlan] = useState('');
  const [isDerived, setIsDerived] = useState(false);
  const [baseRatePlanId, setBaseRatePlanId] = useState('');
  const [formula, setFormula] = useState('base + 500');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cm.categoryId || !name.trim()) {
      setError('Select a room category and enter a rate plan name');
      return;
    }
    setBusy(true);
    try {
      await mutate(
        'rates.createRatePlan',
        {
          roomCategoryId: cm.categoryId,
          name: name.trim(),
          mealPlan: mealPlan || undefined,
          isDerived,
          baseRatePlanId: isDerived ? baseRatePlanId || undefined : undefined,
          formula: isDerived ? formula || undefined : undefined,
        },
        token ?? undefined,
      );
      setName('');
      setMealPlan('');
      setIsDerived(false);
      await cm.refreshRatePlans();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create rate plan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Linked Rate Plan" subtitle="Rate plans per room category — including derived/BAR plans that follow a parent plan by formula (§5.5)." />

      <Card className="mb-6">
        <CardBody>
          <Field label="Room category">
            <select className={inputClass} value={cm.categoryId} onChange={(e) => cm.setCategoryId(e.target.value)}>
              <option value="">— select —</option>
              {cm.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </CardBody>
      </Card>

      {cm.categoryId && (
        <>
          <Card className="mb-6">
            <CardHeader title="Rate plans for this category" />
            <CardBody>
              {cm.ratePlans.length === 0 ? (
                <p className="text-sm text-slate-400">No rate plans yet.</p>
              ) : (
                <div className="space-y-2">
                  {cm.ratePlans.map((rp) => (
                    <div key={rp.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2.5">
                      <div>
                        <span className="text-sm font-medium text-slate-900">{rp.name}</span>
                        {rp.mealPlan && <span className="ml-2 text-xs text-slate-400">{rp.mealPlan}</span>}
                      </div>
                      {rp.isDerived ? (
                        <Badge tone="brand">
                          derived: {rp.formula} (from {cm.ratePlans.find((p) => p.id === rp.baseRatePlanId)?.name ?? '—'})
                        </Badge>
                      ) : (
                        <Badge tone="slate">base plan</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="New rate plan" subtitle="Want this rate plan to follow your main rate automatically? Turn on derived pricing below (§10)." />
            <CardBody>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name">
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BAR, EP, MAP" />
                  </Field>
                  <Field label="Meal plan (optional)">
                    <input className={inputClass} value={mealPlan} onChange={(e) => setMealPlan(e.target.value)} placeholder="e.g. Breakfast included" />
                  </Field>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={isDerived} onChange={(e) => setIsDerived(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  Derive this plan's price from another rate plan
                </label>

                {isDerived && (
                  <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4">
                    <Field label="Base rate plan">
                      <select className={inputClass} value={baseRatePlanId} onChange={(e) => setBaseRatePlanId(e.target.value)}>
                        <option value="">— select —</option>
                        {cm.ratePlans.filter((rp) => !rp.isDerived).map((rp) => (
                          <option key={rp.id} value={rp.id}>
                            {rp.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Formula">
                      <input className={inputClass} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="e.g. base + 500 or base * 1.1" />
                    </Field>
                  </div>
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" variant="secondary" disabled={busy}>
                  Create rate plan
                </Button>
              </form>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
