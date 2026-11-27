// §user request, with a reference app's own "Role Management" (granular permissions) as the
// target — one permission key per top-level sidebar section, grouped roughly how the sidebar
// itself is grouped. A CustomRole's `permissions` array is a subset of these keys; the frontend
// hides any sidebar section whose key isn't in that set. Kept at section granularity (not one key
// per individual Report/Settings sub-page) — matches "granular" without needing 50+ checkboxes for
// a first version, and new sub-pages under an already-permitted section need no catalog change.
export const PERMISSION_CATALOG: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard' }],
  },
  {
    group: 'Stay & Reservations',
    items: [
      { key: 'stay_view', label: 'Stay View (Room View / In-House)' },
      { key: 'calendar_view', label: 'Calendar View' },
      { key: 'reservations', label: 'Reservations' },
      { key: 'guest_messaging', label: 'Guest Messaging' },
      { key: 'ota_reviews', label: 'OTA Reviews' },
      { key: 'room_management', label: 'Room Management (Rate & Inventory, Approval Requests)' },
    ],
  },
  {
    group: 'Money',
    items: [{ key: 'ledger', label: 'Ledger' }],
  },
  {
    group: 'Reports',
    items: [
      { key: 'reports', label: 'Reports' },
      { key: 'customers', label: 'Customers' },
      { key: 'business_reports', label: 'Business Reports' },
    ],
  },
  {
    group: 'Channel Manager',
    items: [
      { key: 'connected_channels', label: 'Connected Channels' },
      { key: 'linked_inventory', label: 'Linked Inventory' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { key: 'settings', label: 'Settings' },
      { key: 'master_data', label: 'Master Data' },
    ],
  },
];

export const PERMISSION_KEYS = PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key));

export const BASE_ROLES = ['owner', 'manager', 'front_desk', 'housekeeping'] as const;
export type BaseRole = (typeof BASE_ROLES)[number];
