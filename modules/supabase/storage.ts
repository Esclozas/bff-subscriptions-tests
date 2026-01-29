function getConfig(bucketOverride?: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = bucketOverride ?? process.env.SUPABASE_BUCKET;

  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  if (!bucket) throw new Error('SUPABASE_BUCKET is not set');

  return { url, key, bucket };
}

function isPublicBucket(bucketOverride?: string) {
  const previewBucket = process.env.SUPABASE_PREVIEW_BUCKET;
  const raw =
    bucketOverride && previewBucket && bucketOverride === previewBucket
      ? process.env.SUPABASE_PREVIEW_BUCKET_PUBLIC ?? ''
      : process.env.SUPABASE_BUCKET_PUBLIC ?? '';
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function encodeStoragePath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function getPublicUrl(path: string, bucketOverride?: string) {
  const { url, bucket } = getConfig(bucketOverride);
  const encoded = encodeStoragePath(path);
  return `${url}/storage/v1/object/public/${bucket}/${encoded}`;
}

export function shouldUsePublicUrl(bucketOverride?: string) {
  return isPublicBucket(bucketOverride);
}

export async function uploadPdf(path: string, file: Uint8Array, bucketOverride?: string) {
  const { url, key, bucket } = getConfig(bucketOverride);
  const encoded = encodeStoragePath(path);
  const body = file instanceof Uint8Array ? file : new Uint8Array(file);
  const bodyInit = body as unknown as BodyInit;

  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encoded}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: bodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase upload failed: ${res.status} ${text}`);
  }

  return { bucket, path };
}

export async function createSignedUrl(path: string, expiresIn: number, bucketOverride?: string) {
  const { url, key, bucket } = getConfig(bucketOverride);
  const encoded = encodeStoragePath(path);

  const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${encoded}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });

  const payload = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const text = payload?.message ?? payload?.error ?? JSON.stringify(payload);
    throw new Error(`Supabase signed URL failed: ${res.status} ${text}`);
  }

  const signedPath = payload?.signedURL ?? payload?.signedUrl ?? null;
  if (!signedPath) {
    throw new Error('Supabase signed URL missing in response');
  }

  const previewUrl = signedPath.startsWith('http') ? signedPath : `${url}${signedPath}`;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return { previewUrl, expiresAt };
}
