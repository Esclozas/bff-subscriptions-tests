export type Cursor = { createdAt: string; id: string };

export function encodeCursor(c: Cursor) {
  return Buffer.from(`${c.createdAt}|${c.id}`, 'utf8').toString('base64');
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const raw = Buffer.from(s, 'base64').toString('utf8');
    const [createdAt, id] = raw.split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
