import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Card, PageHeader } from '../../components/ui';
import { ChannelMappingWizard } from '../ChannelMappingWizard';
import { useCmSelection } from './useCmSelection';
import { ChannelBadge } from './ChannelBadge';
import type { OtaConnection, OtaRoomMapping } from '../../types';

/**
 * "Linked Inventory" — a read-at-a-glance matrix of which physical room category maps to which
 * name on each channel (§7 Phase 1 #6). Editing always goes through the one mapping wizard
 * (same one Connected Channels opens) — this used to also offer a quick inline text edit as a
 * second, inconsistent way to change the same mapping; removed so there's exactly one editing
 * experience for this, reachable from either page.
 */
export function Inventory({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const cm = useCmSelection(hotelId);
  const [mappings, setMappings] = useState<OtaRoomMapping[]>([]);
  const [wizardConnection, setWizardConnection] = useState<OtaConnection | null>(null);

  async function refresh() {
    const all = await Promise.all(
      cm.connections.map((c) => query<OtaRoomMapping[]>('ota.listRoomMappings', { otaConnectionId: c.id }, token ?? undefined)),
    );
    setMappings(all.flat());
  }
  useEffect(() => {
    if (cm.connections.length > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cm.connections.length]);

  if (cm.categories.length === 0 || cm.connections.length === 0) {
    return (
      <div>
        <PageHeader title="Linked Inventory" />
        <Card className="p-6 text-center text-sm text-slate-400">
          Needs at least one room category (Staff & Setup) and one connected channel (Connected Channels) first.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Linked Inventory" subtitle="Every room category's name on every connected channel — click a cell to open its mapping wizard." />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-3">Room category</th>
                {cm.connections.map((c) => (
                  <th key={c.id} className="px-5 py-3">
                    <ChannelBadge source={c.otaCode} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cm.categories.map((cat) => (
                <tr key={cat.id}>
                  <td className="px-5 py-3 font-medium text-slate-900">{cat.name}</td>
                  {cm.connections.map((c) => {
                    const mapping = mappings.find((m) => m.otaConnectionId === c.id && m.roomCategoryId === cat.id);
                    return (
                      <td key={c.id} className="px-5 py-3">
                        <button onClick={() => setWizardConnection(c)} className="text-left hover:underline">
                          {mapping ? mapping.otaRoomName : <span className="text-slate-400">unmapped</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {wizardConnection && (
        <ChannelMappingWizard
          connection={wizardConnection}
          categories={cm.categories}
          onClose={() => {
            setWizardConnection(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
