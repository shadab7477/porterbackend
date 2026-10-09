// config/supportConfig.js

export const SUPPORT_CONFIG = {
  // Ticket Types
  ticketTypes: [
    {
      id: 'complaint',
      label: 'Complaint',
      description: 'A formal complaint regarding a ride, driver/customer behavior, incorrect fare, damaged goods, or service issue.'
    },
    {
      id: 'support_request',
      label: 'Support Request',
      description: 'A general inquiry, help request, account query, or technical question.'
    }
  ],

  // Customer Complaint & Support Categories
  customerCategories: [
    { id: 'driver_behavior', label: 'Driver behavior', type: 'complaint', rideRequired: true },
    { id: 'driver_not_arrived', label: 'Driver did not arrive', type: 'complaint', rideRequired: true },
    { id: 'damaged_missing_goods', label: 'Damaged or missing goods', type: 'complaint', rideRequired: true },
    { id: 'pickup_delivery_issue', label: 'Pickup or delivery issue', type: 'complaint', rideRequired: true },
    { id: 'incorrect_fare', label: 'Incorrect ride fare', type: 'complaint', rideRequired: true },
    { id: 'waiting_charges', label: 'Loading/unloading or waiting charges', type: 'complaint', rideRequired: true },
    { id: 'payment_issue', label: 'Payment issue', type: 'complaint', rideRequired: false },
    { id: 'cancellation_refund', label: 'Cancellation or refund', type: 'complaint', rideRequired: false },
    { id: 'safety_concern', label: 'Safety concern', type: 'complaint', rideRequired: false },
    { id: 'technical_issue', label: 'Technical issue', type: 'support_request', rideRequired: false },
    { id: 'account_issue', label: 'Account & Profile', type: 'support_request', rideRequired: false },
    { id: 'other', label: 'Other', type: 'support_request', rideRequired: false }
  ],

  // Driver Complaint & Support Categories
  driverCategories: [
    { id: 'customer_behavior', label: 'Customer behavior', type: 'complaint', rideRequired: true },
    { id: 'pickup_drop_issue', label: 'Pickup or drop issue', type: 'complaint', rideRequired: true },
    { id: 'waiting_charge_calc', label: 'Waiting-charge calculation', type: 'complaint', rideRequired: true },
    { id: 'ride_fare_payment', label: 'Ride fare or payment', type: 'complaint', rideRequired: true },
    { id: 'cash_settlement', label: 'Cash collection or settlement', type: 'complaint', rideRequired: false },
    { id: 'wallet_earnings', label: 'Wallet and earnings', type: 'complaint', rideRequired: false },
    { id: 'cancellation_dispute', label: 'Cancellation dispute', type: 'complaint', rideRequired: true },
    { id: 'safety_concern', label: 'Safety concern', type: 'complaint', rideRequired: false },
    { id: 'app_gps_issue', label: 'App or GPS issue', type: 'support_request', rideRequired: false },
    { id: 'vehicle_verification', label: 'Vehicle / Document verification', type: 'support_request', rideRequired: false },
    { id: 'other', label: 'Other', type: 'support_request', rideRequired: false }
  ],

  // Permitted Ticket Status Transitions
  statusTransitions: {
    open: ['assigned', 'in_progress', 'closed'],
    assigned: ['in_progress', 'waiting_for_user', 'resolved', 'closed'],
    in_progress: ['waiting_for_user', 'resolved', 'closed', 'assigned'],
    waiting_for_user: ['in_progress', 'resolved', 'closed'],
    resolved: ['closed', 'in_progress', 'open'], // reopen allowed
    closed: ['open', 'in_progress'] // reopen allowed by admin or within policy
  },

  // Priority definitions & SLA targets
  priorities: {
    Critical: { responseSlaHours: 1, resolutionSlaHours: 6 },
    High: { responseSlaHours: 2, resolutionSlaHours: 12 },
    Medium: { responseSlaHours: 4, resolutionSlaHours: 24 },
    Low: { responseSlaHours: 8, resolutionSlaHours: 48 }
  },

  // Attachment Rules
  attachments: {
    maxFiles: 5,
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
      'text/plain'
    ]
  },

  // Reopen window in days after resolution
  reopenWindowDays: 7
};

export const normalizeStatus = (status) => {
  if (!status) return 'open';
  const clean = String(status).toLowerCase().trim().replace(/\s+/g, '_');
  if (clean === 'open') return 'open';
  if (clean === 'assigned') return 'assigned';
  if (clean === 'in_progress') return 'in_progress';
  if (clean === 'waiting_for_user') return 'waiting_for_user';
  if (clean === 'resolved') return 'resolved';
  if (clean === 'closed') return 'closed';
  return clean;
};

export const isValidStatusTransition = (currentStatus, targetStatus) => {
  const from = normalizeStatus(currentStatus);
  const to = normalizeStatus(targetStatus);
  if (from === to) return true;
  const allowed = SUPPORT_CONFIG.statusTransitions[from];
  return Array.isArray(allowed) && allowed.includes(to);
};

export default SUPPORT_CONFIG;
