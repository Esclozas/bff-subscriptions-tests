export type StatementStatus = 'TO_SEND' | 'SENT' | 'PAYED' | 'CANCELLED';

const ALLOWED: Record<StatementStatus, StatementStatus[]> = {
  TO_SEND: ['SENT', 'CANCELLED'],
  SENT: ['PAYED', 'CANCELLED'],
  PAYED: [], // en général interdit -> si refund, autre mécanisme
  CANCELLED: [],
};

export function assertValidStatus(input: unknown): StatementStatus | null {
  if (input === 'TO_SEND' || input === 'SENT' || input === 'PAYED' || input === 'CANCELLED') return input;
  return null;
}

export function canTransition(from: StatementStatus, to: StatementStatus) {
  return (ALLOWED[from] ?? []).includes(to);
}
