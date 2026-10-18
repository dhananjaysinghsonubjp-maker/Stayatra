import { useEffect, useState } from 'react';
import { mutate, query } from '../../api';
import { useAuth } from '../../AuthContext';
import type { OtaConnection, RatePlan, RoomCategory } from '../../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Shared category/rate-plan/OTA-connection/date-range selection, used
 * identically by Calendar, Bulk Update, Update Restrictions and Dynamic
 * Pricing — the four pages the reference product also gates behind this
 * same filter row. Kept as a hook rather than page-lifted state so each page
 * owns its own instance (switching tabs doesn't need to preserve selection).
 */
export function useCmSelection(hotelId: string) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [ratePlanId, setRatePlanId] = useState('');
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [otaConnectionId, setOtaConnectionId] = useState('');
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));

  async function refreshConnections() {
    setConnections(await query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined));
  }

  async function refreshRatePlans(forCategoryId = categoryId) {
    if (!forCategoryId) {
      setRatePlans([]);
      return;
    }
    setRatePlans(await query<RatePlan[]>('rates.listRatePlans', { roomCategoryId: forCategoryId }, token ?? undefined));
  }

  useEffect(() => {
    query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined).then(setCategories);
    void refreshConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  useEffect(() => {
    // A rate plan belongs to exactly one room category — carrying the old selection forward
    // after switching categories let a stale ratePlanId silently get submitted against the
    // new category (the <select> LOOKS reset because the stale id matches no <option> here,
    // but the state itself wasn't touched until this line existed).
    setRatePlanId('');
    void refreshRatePlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  async function addRatePlan(name: string, options?: { isDerived?: boolean; baseRatePlanId?: string; formula?: string; mealPlan?: string }) {
    if (!categoryId || !name) return;
    await mutate('rates.createRatePlan', { roomCategoryId: categoryId, name, ...options }, token ?? undefined);
    await refreshRatePlans();
  }

  return {
    categories,
    categoryId,
    setCategoryId,
    ratePlans,
    ratePlanId,
    setRatePlanId,
    connections,
    otaConnectionId,
    setOtaConnectionId,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    refreshConnections,
    refreshRatePlans,
    addRatePlan,
  };
}

export type CmSelection = ReturnType<typeof useCmSelection>;
