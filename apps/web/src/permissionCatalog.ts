// Mirrors apps/api/src/common/permission-catalog.ts exactly — kept in sync by hand, same as every
// other enum/label duplicated between the two apps in this codebase (e.g. BookingSource labels).
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

export const BASE_ROLES: { value: 'owner' | 'manager' | 'front_desk' | 'housekeeping'; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'front_desk', label: 'Front Desk' },
  { value: 'housekeeping', label: 'Housekeeping' },
];
