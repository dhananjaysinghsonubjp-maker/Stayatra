// §8.1 — "Data redaction, not just access denial." Housekeeping's reads return
// the same rows Front Desk/Owner see, with sensitive fields blanked server-side —
// one query path serves every role correctly instead of three near-duplicate ones.
export function redactForHousekeeping<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    guestName: '—',
    guestPhone: null,
    source: '—',
    paidAmount: null,
    totalAmount: null,
    paymentMethod: null,
    delayResolvedNote: null,
  };
}

export function isHousekeeping(role: string | undefined) {
  return role === 'housekeeping';
}
