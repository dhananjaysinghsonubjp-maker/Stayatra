import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, EmptyState, PageHeader, inputClass } from '../../components/ui';
import type { Department } from '../../types';

/** §user request, with a reference app's own "Departments" list as the target — a lightweight
 * organisational tag list (Front Office / House Keeping / Management, etc.), standalone for now. */
export function DepartmentsPage({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setError(null);
    try {
      setRows(await query<Department[]>('masterData.listDepartments', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load departments');
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
      await mutate('masterData.createDepartment', { hotelId, name: name.trim(), description: description.trim() || undefined }, token ?? undefined);
      setName('');
      setDescription('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add department');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d: Department) {
    await mutate('masterData.updateDepartment', { id: d.id, active: !d.active }, token ?? undefined);
    await refresh();
  }

  async function remove(d: Department) {
    if (!confirm(`Delete "${d.name}"?`)) return;
    await mutate('masterData.deleteDepartment', { id: d.id }, token ?? undefined);
    await refresh();
  }

  return (
    <div>
      <PageHeader title="Departments" subtitle="Organise your workforce by department." action={<Button onClick={() => setAdding((v) => !v)}>+ Add Department</Button>} />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {adding && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <input className={`${inputClass} w-48`} placeholder="Department name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={`${inputClass} w-64`} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
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
          <EmptyState title="No departments yet" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Department Name</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{d.name}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{d.description || '—'}</td>
                    <td className="px-5 py-3">
                      <Badge tone={d.active ? 'available' : 'slate'}>{d.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="text-xs" onClick={() => void toggleActive(d)}>
                          {d.active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button variant="secondary" className="text-xs" onClick={() => void remove(d)}>
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
