/**
 * mediamtx REST API 客戶端（僅供 Backend 在伺服器本機呼叫，9997 不對外開放）。
 */
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL?.trim() || 'http://127.0.0.1:9997'

const STREAM_SERVICE_UNREACHABLE = '串流服務無法連線，請確認 mediamtx 已啟動（port 9997）'

async function request<T>(
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; data?: T; error?: string }> {
  const url = `${MEDIAMTX_API_URL.replace(/\/$/, '')}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mediamtx] 連線失敗:', msg)
    return { status: 0, error: STREAM_SERVICE_UNREACHABLE }
  }
  const text = await res.text()
  let data: T | undefined
  try {
    data = text ? (JSON.parse(text) as T) : undefined
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    return { status: res.status, data, error: text || res.statusText }
  }
  return { status: res.status, data }
}

/**
 * 新增 path（go2rtc 推流用：source = publisher）。
 * path 名 = streamToken。
 */
export async function addPublisherPath(streamToken: string): Promise<{ ok: boolean; error?: string }> {
  const { status, error } = await request('POST', `/v3/config/paths/add/${encodeURIComponent(streamToken)}`, {
    source: 'publisher',
  })
  if (status === 200) return { ok: true }
  if (status === 409 || (error && error.includes('already exists'))) return { ok: true }
  if (status === 0) return { ok: false, error: error ?? STREAM_SERVICE_UNREACHABLE }
  return { ok: false, error: error || `HTTP ${status}` }
}

/**
 * 移除 path。
 */
export async function removePath(streamToken: string): Promise<{ ok: boolean; error?: string }> {
  const { status, error } = await request('DELETE', `/v3/config/paths/remove/${encodeURIComponent(streamToken)}`)
  if (status === 200 || status === 204) return { ok: true }
  if (status === 404) return { ok: true }
  if (status === 0) return { ok: false, error: error ?? STREAM_SERVICE_UNREACHABLE }
  return { ok: false, error: error || `HTTP ${status}` }
}

/**
 * 列出 path（可選：檢查 path 是否存在或 ready）。
 */
export async function listPaths(): Promise<{ items?: Array<{ name: string }> }> {
  const { data } = await request<{ items?: Array<{ name: string }> }>('GET', '/v3/config/paths/list')
  return data || { items: [] }
}

/** Runtime path 項目（目前是否有推流／ready） */
export type RuntimePathItem = { name: string; ready?: boolean }

/**
 * 取得目前有在跑的 path 列表與 ready 狀態（用於判斷攝影機是否線上）。
 * GET /v3/paths/list 回傳實際運行中的 path，含 ready 表示有 publisher 推流中。
 */
export async function getRuntimePathsList(): Promise<RuntimePathItem[]> {
  const { status, data } = await request<{ items?: RuntimePathItem[] }>('GET', '/v3/paths/list')
  if (status === 0 || status !== 200 || !data?.items) return []
  return data.items
}
