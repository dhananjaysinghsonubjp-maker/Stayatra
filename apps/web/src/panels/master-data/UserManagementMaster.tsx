import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, EmptyState, PageHeader, inputClass } from '../../components/ui';
import type { CustomRole, MasterDataUser } from '../../types';

/**
 * §user request — Master Data's "User Management": every login at this hotel, their real backend
 * role, and (the actually-new part) which CustomRole — if any — narrows their sidebar. Creating a
 * user still happens on the existing Staff page (Settings → Hotel Team), not duplicated here.
 */
export function UserManagementMaster({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const isOwner = role('pms') === 'owner';
  const [users, setUsers] = useState<MasterDataUser[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assigningFor, setAssigningFor] = useState<MasterDataUser | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [u, r] = await Promise.all([
        query<MasterDataUser[]>('masterData.listUsersForAccess', { hotelId }, token ?? undefined),
        isOwner ? query<CustomRole[]>('masterData.listCustomRoles', { hotelId }, token ?? undefined) : Promise.resolve([]),
      ]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  return (
    <div>
      <PageHeader title="User Management" subtitle="Everyone with login access at this hotel, their role, and the granular access role (if any) narrowing their sidebar." />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {users.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No users yet" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Access Role</th>
                  <th className="px-5 py-3">Status</th>
                  {isOwner && <th className="px-5 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{u.name}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{u.email || '—'}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{u.phone || '—'}</td>
                    <td className="px-5 py-3 capitalize text-slate-600 dark:text-slate-300">{u.pmsRole?.replace('_', ' ') ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{u.customRoleName ?? <span className="text-slate-400 dark:text-slate-500">— full access —</span>}</td>
                    <td className="px-5 py-3">
                      <Badge tone={u.active ? 'available' : 'slate'}>{u.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {isOwner && (
                      <td className="px-5 py-3 text-right">
                        <Button variant="secondary" className="text-xs" onClick={() => setAssigningFor(u)}>
                          Set Access Role
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {assigningFor && (
        <AssignRoleModal
          user={assigningFor}
          roles={roles}
          onClose={() => setAssigningFor(null)}
          onSaved={() => {
            setAssigningFor(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function AssignRoleModal({ user, roles, onClose, onSaved }: { user: MasterDataUser; roles: CustomRole[]; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [customRoleId, setCustomRoleId] = useState(user.customRoleId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await mutate('masterData.assignCustomRole', { userId: user.id, customRoleId: customRoleId || null }, token ?? undefined);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update access role');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !saving && onClose()}>
      <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-lg font-bold text-slate-900 dark:text-white">Set Access Role</p>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{user.name}</p>
        <select className={inputClass} value={customRoleId} onChange={(e) => setCustomRoleId(e.target.value)}>
          <option value="">— full access (no custom role) —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Choosing a role also sets this user's real access to match that role's Base Access.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
