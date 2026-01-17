export type IssueStatus = 'ISSUED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID';

const PAYMENT_ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  UNPAID: ['PAID'],
  PAID: ['UNPAID'],
};

export function assertValidIssueStatus(input: unknown): IssueStatus | null {
  if (input === 'ISSUED' || input === 'CANCELLED') return input;
  return null;
}

export function assertValidPaymentStatus(input: unknown): PaymentStatus | null {
  if (input === 'UNPAID' || input === 'PAID') return input;
  return null;
}

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus) {
  return (PAYMENT_ALLOWED[from] ?? []).includes(to);
}
