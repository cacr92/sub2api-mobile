import { cchConfigState } from '@/src/store/cch-config';

type CchFetchOptions = {
  requiresApiKey?: boolean;
};

export function getCchErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'CCH_BASE_URL_REQUIRED':
        return '请先填写 CCH 服务地址。';
      case 'CCH_API_KEY_REQUIRED':
        return '请先填写 CCH Admin Key。';
      case 'CCH_AUTH_FAILED':
        return 'CCH Admin Key 无效或已失效。';
      case 'CCH_ACCESS_DENIED':
        return '当前 CCH Admin Key 没有读取管理数据的权限。';
      case 'CCH_INVALID_SERVER_RESPONSE':
        return '当前地址返回的数据不是可识别的 CCH 管理接口。';
      case 'HTTP_404':
        return '当前 CCH 版本未提供此接口。';
      default:
        return error.message;
    }
  }

  return '无法连接 CCH，请检查地址、CCH Admin Key 和网络。';
}

function buildRequestUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  for (const prefix of ['/api/v1', '/api']) {
    if (normalizedBase.endsWith(prefix)) {
      const baseWithoutPrefix = normalizedBase.slice(0, -prefix.length);
      return `${baseWithoutPrefix}${normalizedPath}`;
    }
  }

  return `${normalizedBase}${normalizedPath}`;
}

function getProblemCode(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;

  const errorCode = (value as Record<string, unknown>).errorCode;
  return typeof errorCode === 'string' ? errorCode : undefined;
}

function createCchRequest(path: string, init: RequestInit, options?: CchFetchOptions) {
  const baseUrl = cchConfigState.baseUrl.trim();
  const apiKey = cchConfigState.apiKey.trim();
  const requiresApiKey = options?.requiresApiKey !== false;

  if (!baseUrl) throw new Error('CCH_BASE_URL_REQUIRED');
  if (requiresApiKey && !apiKey) throw new Error('CCH_API_KEY_REQUIRED');

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (requiresApiKey && apiKey) headers.set('X-Api-Key', apiKey);

  return {
    url: buildRequestUrl(baseUrl, path),
    init: { ...init, headers },
  };
}

export async function cchFetch<T>(
  path: string,
  init: RequestInit = {},
  options?: CchFetchOptions
): Promise<T> {
  const request = createCchRequest(path, init, options);
  const response = await fetch(request.url, request.init);
  const rawText = await response.text();

  let body: unknown;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    throw new Error('CCH_INVALID_SERVER_RESPONSE');
  }

  if (!response.ok) {
    const problemCode = getProblemCode(body);

    if (response.status === 401 || problemCode === 'auth.missing') {
      throw new Error('CCH_AUTH_FAILED');
    }
    if (response.status === 403) {
      throw new Error('CCH_ACCESS_DENIED');
    }

    throw new Error(`HTTP_${response.status}`);
  }

  return body as T;
}
