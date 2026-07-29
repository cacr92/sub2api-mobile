import { adminConfigState } from '@/src/store/admin-config';
import type { ApiEnvelope } from '@/src/types/admin';

type AdminFetchOptions = {
  idempotencyKey?: string;
};

function buildRequestUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const duplicatedPrefixes = ['/api/v1', '/api'];

  for (const prefix of duplicatedPrefixes) {
    if (normalizedBase.endsWith(prefix) && normalizedPath.startsWith(`${prefix}/`)) {
      const baseWithoutPrefix = normalizedBase.slice(0, -prefix.length);
      return `${baseWithoutPrefix}${normalizedPath}`;
    }
  }

  return `${normalizedBase}${normalizedPath}`;
}

function createAdminRequest(path: string, init: RequestInit, options?: AdminFetchOptions) {
  const baseUrl = adminConfigState.baseUrl.trim().replace(/\/$/, '');
  const adminApiKey = adminConfigState.adminApiKey.trim();

  if (!baseUrl) {
    throw new Error('BASE_URL_REQUIRED');
  }

  if (!adminApiKey) {
    throw new Error('ADMIN_API_KEY_REQUIRED');
  }

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('x-api-key', adminApiKey);

  if (options?.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  return {
    url: buildRequestUrl(baseUrl, path),
    init: {
      ...init,
      headers,
    },
  };
}

export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
  options?: AdminFetchOptions
): Promise<T> {
  const request = createAdminRequest(path, init, options);
  const response = await fetch(request.url, request.init);

  let json: ApiEnvelope<T>;
  const rawText = await response.text();

  try {
    json = JSON.parse(rawText) as ApiEnvelope<T>;
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    throw new Error('INVALID_SERVER_RESPONSE');
  }

  if (!response.ok || json.code !== 0) {
    throw new Error(json.reason || json.message || 'REQUEST_FAILED');
  }

  return json.data as T;
}

export async function adminFetchSse(path: string, init: RequestInit = {}): Promise<Response> {
  const request = createAdminRequest(path, init);
  const headers = new Headers(request.init.headers);
  headers.set('Accept', 'text/event-stream');

  const response = await fetch(request.url, {
    ...request.init,
    headers,
  });

  if (response.ok) {
    return response;
  }

  const rawText = await response.text();

  try {
    const json = JSON.parse(rawText) as Partial<ApiEnvelope<unknown>>;
    const message = json.reason || json.message;

    if (typeof message === 'string' && message.trim()) {
      throw new Error(message.trim());
    }
  } catch (error) {
    if (error instanceof Error && error.name !== 'SyntaxError') {
      throw error;
    }
  }

  throw new Error(`HTTP_${response.status}`);
}
