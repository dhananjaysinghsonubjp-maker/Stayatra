import type { PaymentMethod } from './types';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'company_settlement', label: 'Company Settlement' },
  { value: 'agent_settlement', label: 'Agent Settlement' },
  { value: 'upi', label: 'UPI' },
  { value: 'credit_sale', label: 'Credit Sale' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash_deposit', label: 'Cash Deposit' },
];

export const paymentMethodLabel = (m: PaymentMethod) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;
