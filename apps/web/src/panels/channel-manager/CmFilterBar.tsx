import { Button, Card, CardBody, Field, inputClass } from '../../components/ui';
import type { CmSelection } from './useCmSelection';
import { OTA_LABEL } from './ota-labels';

/** The shared category → rate plan (+create) → OTA connection → date-range row used by Calendar, Bulk Update, Update Restrictions and Dynamic Pricing. */
export function CmFilterBar({ cm, showDates = true }: { cm: CmSelection; showDates?: boolean }) {
  return (
    <Card className="mb-6">
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

          <Field label="Rate plan">
            <div className="flex gap-2">
              <select className={`${inputClass} flex-1`} value={cm.ratePlanId} onChange={(e) => cm.setRatePlanId(e.target.value)} disabled={!cm.categoryId}>
                <option value="">— select —</option>
                {cm.ratePlans.map((rp) => (
                  <option key={rp.id} value={rp.id}>
                    {rp.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" disabled={!cm.categoryId} onClick={() => cm.addRatePlan(prompt('Rate plan name?', 'BAR') || '')}>
                +
              </Button>
            </div>
          </Field>

          <Field label="OTA connection">
            <select className={inputClass} value={cm.otaConnectionId} onChange={(e) => cm.setOtaConnectionId(e.target.value)}>
              <option value="">— select —</option>
              {cm.connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {OTA_LABEL[c.otaCode] ?? c.otaCode} ({c.status})
                </option>
              ))}
            </select>
          </Field>

          {showDates && (
            <>
              <Field label="From">
                <input className={inputClass} type="date" value={cm.startDate} onChange={(e) => cm.setStartDate(e.target.value)} />
              </Field>
              <Field label="To">
                <input className={inputClass} type="date" value={cm.endDate} onChange={(e) => cm.setEndDate(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
