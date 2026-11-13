export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'NETWORK_ERROR') {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: options.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('서버에 연결할 수 없습니다. 연결을 확인한 후 다시 시도해 주세요.');
  }
  const data = await response.json().catch(() => null);
  if (options.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
  if (!response.ok) throw new ApiError(data?.error ?? `Request failed (${response.status})`, response.status, data?.code ?? 'REQUEST_FAILED');
  if (data === null) throw new ApiError('The server returned an invalid response.', response.status, 'INVALID_RESPONSE');
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 완료하지 못했습니다.';
}
