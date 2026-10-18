/**
 * §user request — "General Manager" and "Front Office Manager" are two job-title choices a
 * hotel can pick between; both carry the same permission level underneath.
 *
 * §user request (2026-10-15) — "ye saara FMO ki ID mein daal do": that level is now `manager`,
 * not a separate narrow role — `manager` is what actually unlocks Reports/Channel Manager/
 * Settings/Audit Log everywhere else in the backend, matching the owner's own sidebar apart
 * from Billing and staff approval/PIN-minting (kept owner-only, confirmed explicitly).
 */
export const DESIGNATION_OPTIONS: { designation: string; role: 'manager' | 'housekeeping' }[] = [
  { designation: 'General Manager', role: 'manager' },
  { designation: 'Front Office Manager', role: 'manager' },
  { designation: 'Housekeeping Staff', role: 'housekeeping' },
];

/** §user request — which shift a housekeeping staff member works. Housekeeping-only, shown on
 * the propose/edit form when the selected designation's role is 'housekeeping'. */
export const SHIFT_OPTIONS = ['Morning (6 AM – 2 PM)', 'Evening (2 PM – 10 PM)', 'Night (10 PM – 6 AM)'];
