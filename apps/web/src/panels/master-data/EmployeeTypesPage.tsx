import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, EmptyState, PageHeader, inputClass } from '../../components/ui';
import type { EmployeeType } from '../../types';

/** §user request, with a reference app's own "Employee Type" list as the target — a lightweight
 * employment-type tag list (Permanent / Contract / Part-time, etc.), standalone for now. */
export function EmployeeTypesPage({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<EmployeeType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setError(null);
    try {
      setRows(await query<EmployeeType[]>('masterData.listEmployeeTypes', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load employee types');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await mutate('masterData.createEmployeeType', { hotelId, name: name.trim() }, token ?? undefined);
      setName('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add employee type');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: EmployeeType) {
    await mutate('masterData.updateEmployeeType', { id: t.id, active: !t.active }, token ?? undefined);
    await refresh();
  }

  async function remove(t: EmployeeType) {
    if (!confirm(`Delete "${t.name}"?`)) return;
    await mutate('masterData.deleteEmployeeType', { id: t.id }, token ?? undefined);
    await refresh();
  }

  return (
    <div>
      <PageHeader title="Employee Type" subtitle="Employment types your staff roster can be tagged with." action={<Button onClick={() => setAdding((v) => !v)}>+ Add Employee Type</Button>} />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {adding && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <input className={`${inputClass} w-48`} placeholder="e.g. Permanent" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={() => void add()} disabled={saving || !name.trim()}>
              {saving ? 'Adding…' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No employee types yet" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{t.name}</td>
                    <td className="px-5 py-3">
                      <Badge tone={t.active ? 'available' : 'slate'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="text-xs" onClick={() => void toggleActive(t)}>
                          {t.active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button variant="secondary" className="text-xs" onClick={() => void remove(t)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
