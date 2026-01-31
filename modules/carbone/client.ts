const CARBONE_BASE_URL = 'https://api.carbone.io';

type CarboneJson = {
  success?: boolean;
  error?: string;
  code?: string;
  data?: any;
  renderId?: string;
};

function getApiKey() {
  const key = process.env.CARBONE_API_KEY;
  if (!key) throw new Error('CARBONE_API_KEY is not set');
  return key;
}

export async function renderCarbonePdf(templateId: string, data: any) {
  if (!templateId) throw new Error('CARBONE_TEMPLATE_ID is missing');

  const renderTarget = templateId;
  const carboneVersion = process.env.CARBONE_API_VERSION ?? '5';

  const carboneLang = process.env.CARBONE_LANG ?? 'fr';
  const requestBody: Record<string, unknown> = { data, convertTo: 'pdf' };
  if (carboneLang) requestBody.lang = carboneLang;

  const res = await fetch(`${CARBONE_BASE_URL}/render/${renderTarget}`, {
    method: 'POST',
    headers: {
      Authorization: getApiKey(),
      'Content-Type': 'application/json',
      'carbone-version': carboneVersion,
    },
    body: JSON.stringify(requestBody),
    cache: 'no-store',
  });

  const contentType = res.headers.get('content-type') ?? '';

  if (!res.ok && !contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(`Carbone render failed: ${res.status} ${text}`);
  }

  if (!contentType.includes('application/json')) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer;
  }

  const payload = (await res.json()) as CarboneJson;
  if (payload.success === false) {
    throw new Error(payload.error ?? 'Carbone render failed');
  }

  const renderId =
    payload.data?.renderId ??
    payload.data?.id ??
    payload.renderId ??
    null;

  if (!renderId) {
    throw new Error('Carbone render did not return a renderId');
  }

  const fileRes = await fetch(`${CARBONE_BASE_URL}/render/${renderId}`, {
    headers: { Authorization: getApiKey() },
    cache: 'no-store',
  });

  if (!fileRes.ok) {
    const text = await fileRes.text().catch(() => '');
    throw new Error(`Carbone download failed: ${fileRes.status} ${text}`);
  }

  return Buffer.from(await fileRes.arrayBuffer());
}
