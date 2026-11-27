import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, EmptyState, Field, PageHeader, inputClass } from '../../components/ui';
import { PERMISSION_CATALOG, BASE_ROLES } from '../../permissionCatalog';
import type { CustomRole } from '../../types';

/**
 * §user request — "Role Management mein granular permissions chahiye, poora custom permission
 * builder": an owner creates a role, picks which sidebar sections it can see (checkboxes, grouped
 * exactly like permissionCatalog.ts), and which of the app's own existing fixed roles it inherits
 * real backend access from. See CustomRole's own schema comment for what this does and doesn't
 * change — assigning it to a user happens from User Management, not here.
 */
export function RoleManagement({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);

  useEffect(() => {
    async function load() {
      setError(null);
      try {
        setRoles(await query<CustomRole[]>('masterData.listCustomRoles', { hotelId }, token ?? undefined));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load roles');
      }
    }
    void load();
  }, [hotelId, token]);

  async function reload() {
    try {
      setRoles(await query<CustomRole[]>('masterData.listCustomRoles', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load roles');
    }
  }

  async function remove(role: CustomRole) {
    if (!confirm(`Delete the "${role.name}" role? ${role.userCount > 0 ? `${role.userCount} user(s) using it will lose it.` : ''}`)) return;
    try {
      await mutate('masterData.deleteCustomRole', { roleId: role.id }, token ?? undefined);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete role');
    }
  }

  return (
    <div>
      <PageHeader
        title="Role Management"
        subtitle="Create and manage custom roles with granular, section-level permissions."
        action={<Button onClick={() => setEditing('new')}>+ Add Role</Button>}
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {roles.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No custom roles yet" hint="Add one to start narrowing what a user's sidebar shows them." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Role Name</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Base Access</th>
                  <th className="px-5 py-3">Users</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {roles.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{r.name}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{r.description || '—'}</td>
                    <td className="px-5 py-3 capitalize text-slate-600 dark:text-slate-300">{r.baseRole.replace('_', ' ')}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{r.userCount}</td>
                    <td className="px-5 py-3">
                      <Badge tone={r.active ? 'available' : 'slate'}>{r.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="text-xs" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button variant="secondary" className="text-xs" onClick={() => void remove(r)}>
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

      {editing && (
        <RoleEditor
          hotelId={hotelId}
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function RoleEditor({ hotelId, role, onClose, onSaved }: { hotelId: string; role: CustomRole | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [baseRole, setBaseRole] = useState<CustomRole['baseRole']>(role?.baseRole ?? 'front_desk');
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [active, setActive] = useState(role?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  async function save() {
    if (!name.trim()) {
      setError('Role name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (role) {
        await mutate(
          'masterData.updateCustomRole',
          { roleId: role.id, name: name.trim(), description: description.trim() || undefined, baseRole, permissions, active },
          token ?? undefined,
        );
      } else {
        await mutate(
          'masterData.createCustomRole',
          { hotelId, name: name.trim(), description: description.trim() || undefined, baseRole, permissions },
          token ?? undefined,
        );
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save role');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={() => !saving && onClose()}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5 dark:border-slate-700">
          <p className="text-lg font-bold text-slate-900 dark:text-white">{role ? 'Edit Role' : 'Add Role'}</p>
          <button onClick={() => !saving && onClose()} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Field label="Role Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Junior Receptionist" />
          </Field>
          <Field label="Description (optional)">
            <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Base Access (which existing role's backend access this inherits)">
            <select className={inputClass} value={baseRole} onChange={(e) => setBaseRole(e.target.value as CustomRole['baseRole'])}>
              {BASE_ROLES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>

          {role && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active
            </label>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Permissions — which sidebar sections this role can see</p>
            <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              {PERMISSION_CATALOG.map((group) => (
                <div key={group.group}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{group.group}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={permissions.includes(item.key)} onChange={() => toggle(item.key)} />
                        <span className="text-slate-700 dark:text-slate-200">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 dark:border-slate-700">
          <button onClick={() => !saving && onClose()} className="text-sm font-medium text-slate-500 hover:underline">
            Cancel
          </button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Role'}
          </Button>
        </div>
      </div>
    </div>
  );
}
