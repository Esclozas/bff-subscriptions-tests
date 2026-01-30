export type StatementGroupKey = { group_key: string; currency: string };

export function buildStatementNumber(paymentListId: string, currency: string, index: number) {
  const short = paymentListId.slice(0, 8);
  const cur = (currency ?? '').trim();
  return `PL-${short}-${cur}-${index + 1}`;
}

export function sortStatementGroups<T extends StatementGroupKey>(groups: T[]) {
  return [...groups].sort(
    (a, b) =>
      a.group_key.localeCompare(b.group_key) || a.currency.localeCompare(b.currency),
  );
}
