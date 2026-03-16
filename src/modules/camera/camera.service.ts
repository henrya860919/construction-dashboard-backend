import crypto from 'node:crypto'
import archiver from 'archiver'
import { Writable } from 'node:stream'
import { AppError } from '../../shared/errors.js'
import { prisma } from '../../lib/db.js'
import { projectRepository } from '../project/project.repository.js'
import { cameraRepository, type CameraRecord } from './camera.repository.js'
import { encryption } from '../../lib/encryption.js'
import * as mediamtx from '../../lib/mediamtx.js'
import type { CreateCameraInput, UpdateCameraInput } from '../../schemas/camera.js'

const PLAY_URL_EXPIRES_SEC = 15 * 60 // 15 min
const GO2RTC_VERSION = process.env.GO2RTC_VERSION?.trim() || '1.9.14'

/** Mac 安裝說明（zip 內附，避免雙擊被擋時使用者不知如何用終端機執行） */
const MAC_README = `Mac 安裝說明
================

若雙擊 run.command 時出現「無法打開」或「已阻擋」：

請改用終端機執行（一次即可，之後會自動清除隔離屬性）：

1. 開啟「終端機」（應用程式 → 工具程式 → 終端機）
2. 輸入：cd 
   （cd 後面有一個空格，不要按 Enter）
3. 把「此資料夾」拖進終端機視窗，放開滑鼠
4. 按 Enter
5. 輸入：xattr -cr . && chmod +x run.sh && ./run.sh
6. 按 Enter 執行

執行後會自動下載 go2rtc（若尚未下載）並啟動推流。
之後可直接雙擊 run.command 啟動（無須再開終端機）。
`
const MEDIAMTX_PUBLIC_HOST =
  process.env.MEDIAMTX_PUBLIC_HOST?.trim() || process.env.MEDIAMTX_WEBRTC_URL?.trim() || 'http://localhost:8889'

/** 攝影機連線狀態：依實際推流與歷史判斷 */
export type CameraConnectionStatus = 'online' | 'offline' | 'not_configured'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensureUserCanAccessProject(
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean
): Promise<void> {
  if (isPlatformAdmin) return
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { status: true },
  })
  if (!member || member.status !== 'active') {
    throw new AppError(403, 'FORBIDDEN', '非專案成員或已停用，無法存取此專案攝影機')
  }
}

function maskSourceUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = '****'
    if (u.username) u.username = u.username.slice(0, 2) + '***'
    return u.toString()
  } catch {
    return '****'
  }
}

/** 解析 RTSP URL 為 host / port / path / username / password（供設定表單分欄顯示與組回用） */
function parseRtspUrl(url: string): {
  host: string
  port: number
  path: string
  username?: string
  password?: string
} | null {
  const trimmed = url?.trim()
  if (!trimmed || !trimmed.startsWith('rtsp://')) return null
  try {
    const u = new URL(trimmed)
    const host = u.hostname || ''
    const port = u.port ? parseInt(u.port, 10) : 554
    const path = u.pathname && u.pathname !== '/' ? u.pathname : ''
    const username = u.username || undefined
    const password = u.password || undefined
    return { host, port, path, ...(username && { username }), ...(password && { password }) }
  } catch {
    return null
  }
}

/** 由分欄組回 RTSP URL */
function buildRtspUrl(parts: {
  host: string
  port?: number
  path?: string
  username?: string
  password?: string
}): string {
  const host = parts.host?.trim() || '192.168.1.1'
  const port = parts.port && parts.port > 0 ? parts.port : 554
  const path = parts.path?.trim().replace(/^\/+/, '') || ''
  const pathPart = path ? `/${path}` : ''
  if (parts.username?.trim() && parts.password !== undefined) {
    const user = encodeURIComponent(parts.username.trim())
    const pass = encodeURIComponent(parts.password)
    return `rtsp://${user}:${pass}@${host}:${port}${pathPart}`
  }
  return `rtsp://${host}:${port}${pathPart}`
}

export const cameraService = {
  async create(
    projectId: string,
    input: CreateCameraInput,
    userId: string,
    user: AuthUser
  ): Promise<CameraRecord> {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const project = await projectRepository.findById(projectId)
    if (!project) throw new AppError(404, 'NOT_FOUND', '找不到該專案')

    const streamToken = crypto.randomUUID()
    let sourceUrlEnc: string | null = null
    if (input.sourceUrl?.trim()) {
      const enc = encryption.encrypt(input.sourceUrl.trim())
      sourceUrlEnc = enc ?? input.sourceUrl.trim()
    }

    const added = await mediamtx.addPublisherPath(streamToken)
    if (!added.ok) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', `無法向串流伺服器註冊此攝影機：${added.error ?? '未知錯誤'}`)
    }

    const camera = await cameraRepository.create({
      projectId,
      tenantId: project.tenantId,
      name: input.name.trim(),
      streamToken,
      connectionMode: 'go2rtc',
      sourceUrlEnc,
      status: 'active',
    })
    return camera
  },

  /**
   * 取得目前 mediamtx 正在推流（ready）的 path 名稱集合；失敗時回傳空集合。
   */
  async getReadyStreamTokens(): Promise<Set<string>> {
    try {
      const items = await mediamtx.getRuntimePathsList()
      return new Set(
        items.filter((p) => p.ready === true).map((p) => p.name)
      )
    } catch {
      return new Set()
    }
  },

  /**
   * 依 mediamtx 即時狀態與 lastStreamAt 計算連線狀態；若有 connectionStatusOverride === 'offline' 則顯示為離線。
   */
  async resolveConnectionStatus(
    cameras: (CameraRecord & { lastStreamAt: Date | null })[],
    readyTokens: Set<string>
  ): Promise<
    Array<
      CameraRecord & {
        connectionStatus: CameraConnectionStatus
        actualConnectionStatus?: CameraConnectionStatus
        connectionStatusOverride?: string | null
      }
    >
  > {
    const now = new Date()
    const result: Array<
      CameraRecord & {
        connectionStatus: CameraConnectionStatus
        actualConnectionStatus?: CameraConnectionStatus
        connectionStatusOverride?: string | null
      }
    > = []
    const toUpdate: { id: string }[] = []
    for (const cam of cameras) {
      const isReady = readyTokens.has(cam.streamToken)
      let actual: CameraConnectionStatus
      if (isReady) {
        actual = 'online'
        toUpdate.push({ id: cam.id })
      } else if (cam.lastStreamAt != null) {
        actual = 'offline'
      } else {
        actual = 'not_configured'
      }
      const override = (cam as CameraRecord & { connectionStatusOverride?: string | null }).connectionStatusOverride
      const connectionStatus = override === 'offline' ? 'offline' : actual
      result.push({
        ...cam,
        connectionStatus,
        ...(override === 'offline' && { actualConnectionStatus: actual }),
        connectionStatusOverride: override ?? null,
      })
    }
    await Promise.all(toUpdate.map(({ id }) => cameraRepository.updateLastStreamAt(id, now)))
    return result
  },

  async list(
    projectId: string,
    userId: string,
    user: AuthUser
  ): Promise<
    Array<
      CameraRecord & {
        connectionStatus: CameraConnectionStatus
        actualConnectionStatus?: CameraConnectionStatus
        connectionStatusOverride?: string | null
      }
    >
  > {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const cameras = await cameraRepository.findByProjectId(projectId)
    const readyTokens = await this.getReadyStreamTokens()
    return this.resolveConnectionStatus(cameras, readyTokens)
  },

  async getById(
    cameraId: string,
    projectId: string,
    userId: string,
    user: AuthUser
  ): Promise<
    CameraRecord & {
      connectionStatus: CameraConnectionStatus
      connectionStatusOverride?: string | null
      actualConnectionStatus?: CameraConnectionStatus
      sourceHost?: string
      sourcePort?: number
      sourcePath?: string
      hasCredentials?: boolean
      usernameMasked?: string
    }
  > {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const row = await cameraRepository.findByIdWithSourceEnc(cameraId)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (row.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    const { sourceUrlEnc, ...cam } = row
    const readyTokens = await this.getReadyStreamTokens()
    const [res] = await this.resolveConnectionStatus([cam as CameraRecord], readyTokens)
    const out = { ...res } as ReturnType<typeof this.getById> extends Promise<infer R> ? R : never
    if (sourceUrlEnc) {
      const dec = encryption.decrypt(sourceUrlEnc)
      const parsed = dec ? parseRtspUrl(dec) : null
      if (parsed) {
        ;(out as Record<string, unknown>).sourceHost = parsed.host
        ;(out as Record<string, unknown>).sourcePort = parsed.port
        ;(out as Record<string, unknown>).sourcePath = parsed.path || ''
        ;(out as Record<string, unknown>).hasCredentials = !!(parsed.username || parsed.password)
        ;(out as Record<string, unknown>).usernameMasked = parsed.username
          ? parsed.username.slice(0, 2) + '***'
          : undefined
      }
    }
    return out
  },

  async getByIdWithSourceUrlDecrypted(cameraId: string, projectId: string, userId: string, user: AuthUser) {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const row = await cameraRepository.findByIdWithSourceEnc(cameraId)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (row.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    let sourceUrlMasked: string | null = null
    if (row.sourceUrlEnc) {
      const dec = encryption.decrypt(row.sourceUrlEnc)
      sourceUrlMasked = dec ? maskSourceUrl(dec) : null
    }
    const { sourceUrlEnc: _, ...rest } = row
    return { ...rest, sourceUrlMasked }
  },

  async update(
    cameraId: string,
    projectId: string,
    input: UpdateCameraInput,
    userId: string,
    user: AuthUser
  ): Promise<CameraRecord> {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const camera = await cameraRepository.findById(cameraId)
    if (!camera) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')

    let sourceUrlEnc: string | null | undefined = undefined
    if (input.sourceUrl !== undefined) {
      if (input.sourceUrl === '' || input.sourceUrl === null) {
        sourceUrlEnc = null
      } else {
        const enc = encryption.encrypt(input.sourceUrl)
        sourceUrlEnc = enc ?? input.sourceUrl
      }
    } else if (input.sourceHost !== undefined) {
      const host = input.sourceHost.trim()
      const port = input.sourcePort ?? 554
      const path = (input.sourcePath ?? '').trim().replace(/^\/+/, '')
      const hasCredentials = !!input.hasCredentials
      const username = input.username?.trim()
      const password = input.password

      let url: string
      if (hasCredentials && (username || (password !== undefined && password !== null))) {
        const row = await cameraRepository.findByIdWithSourceEnc(cameraId)
        const existing = row?.sourceUrlEnc ? encryption.decrypt(row.sourceUrlEnc) : null
        const parsed = existing ? parseRtspUrl(existing) : null
        const u = username ?? parsed?.username ?? ''
        const p = password !== undefined && password !== null ? password : (parsed?.password ?? '')
        url = buildRtspUrl({ host, port, path, username: u, password: p })
      } else if (hasCredentials) {
        const row = await cameraRepository.findByIdWithSourceEnc(cameraId)
        const existing = row?.sourceUrlEnc ? encryption.decrypt(row.sourceUrlEnc) : null
        const parsed = existing ? parseRtspUrl(existing) : null
        if (parsed?.username != null && parsed?.password != null) {
          url = buildRtspUrl({
            host,
            port,
            path,
            username: parsed.username,
            password: parsed.password,
          })
        } else {
          url = buildRtspUrl({ host, port, path })
        }
      } else {
        url = buildRtspUrl({ host, port, path })
      }
      const enc = encryption.encrypt(url)
      sourceUrlEnc = enc ?? url
    }

    return cameraRepository.update(cameraId, {
      name: input.name,
      status: input.status,
      sourceUrlEnc,
    })
  },

  async delete(cameraId: string, projectId: string, userId: string, user: AuthUser): Promise<void> {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const camera = await cameraRepository.findById(cameraId)
    if (!camera) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')

    const removed = await mediamtx.removePath(camera.streamToken)
    if (!removed.ok) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', removed.error ?? '串流服務暫時無法連線，無法從 mediamtx 移除路徑')
    }
    await cameraRepository.delete(cameraId)
  },

  /** 手動標示為離線（或清除標示）；不影響實際串流，僅影響顯示狀態 */
  async setConnectionStatusOverride(
    cameraId: string,
    projectId: string,
    override: 'offline' | null,
    userId: string,
    user: AuthUser
  ): Promise<CameraRecord> {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const camera = await cameraRepository.findById(cameraId)
    if (!camera) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    return cameraRepository.update(cameraId, { connectionStatusOverride: override })
  },

  async getPlayUrl(cameraId: string, projectId: string, userId: string, user: AuthUser) {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const camera = await cameraRepository.findById(cameraId)
    if (!camera) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.status !== 'active') {
      throw new AppError(400, 'CAMERA_DISABLED', '此攝影機已停用，無法播放')
    }

    const base = MEDIAMTX_PUBLIC_HOST.replace(/\/$/, '')
    const url = `${base}/${camera.streamToken}/whep`
    const expiresAt = new Date(Date.now() + PLAY_URL_EXPIRES_SEC * 1000)
    return { url, expiresAt: expiresAt.toISOString(), expiresIn: PLAY_URL_EXPIRES_SEC }
  },

  async getInstallConfig(cameraId: string, projectId: string, userId: string, user: AuthUser) {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const camera = await cameraRepository.findById(cameraId)
    if (!camera) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')

    const base = MEDIAMTX_PUBLIC_HOST.replace(/\/$/, '')
    const hostForRtmp = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '')
    const rtmpPort = process.env.MEDIAMTX_RTMP_PORT?.trim() || '1935'
    const rtmpPublishUrl = `rtmp://${hostForRtmp}:${rtmpPort}/${camera.streamToken}`

    const yamlSnippet = `# go2rtc 推流設定（請加入 streams 區塊）
# publish 的 key 必須與 streams 的 stream 名稱相同
publish:
  ${camera.streamToken}:
    - ${rtmpPublishUrl}

streams:
  ${camera.streamToken}:
    # 請改為現場攝影機的 RTSP 網址，例如：
    # - rtsp://使用者:密碼@192.168.1.100:554/stream1
    - rtsp://YOUR_CAMERA_IP:554/stream1
`

    return {
      streamToken: camera.streamToken,
      mediamtxHost: hostForRtmp,
      mediamtxWebRtcUrl: `${base}/${camera.streamToken}`,
      rtmpPublishUrl,
      go2rtcYamlSnippet: yamlSnippet,
    }
  },

  /**
   * 取得攝影機安裝用資料（含解密後的 RTSP，僅供產出下載檔使用）
   */
  async getInstallDataWithSourceUrl(
    cameraId: string,
    projectId: string,
    userId: string,
    user: AuthUser
  ): Promise<{ streamToken: string; rtmpPublishUrl: string; sourceUrl: string | null }> {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const camera = await cameraRepository.findByIdWithSourceEnc(cameraId)
    if (!camera) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    if (camera.projectId !== projectId) throw new AppError(404, 'NOT_FOUND', '找不到該攝影機')
    const base = MEDIAMTX_PUBLIC_HOST.replace(/\/$/, '')
    const hostForRtmp = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '')
    const rtmpPort = process.env.MEDIAMTX_RTMP_PORT?.trim() || '1935'
    const rtmpPublishUrl = `rtmp://${hostForRtmp}:${rtmpPort}/${camera.streamToken}`
    const sourceUrl = camera.sourceUrlEnc ? encryption.decrypt(camera.sourceUrlEnc) : null
    return { streamToken: camera.streamToken, rtmpPublishUrl, sourceUrl }
  },

  /** 產出完整 go2rtc.yaml（若已填設備 RTSP 則預填好，下載即可用） */
  async getInstallYamlContent(cameraId: string, projectId: string, userId: string, user: AuthUser): Promise<string> {
    const { streamToken, rtmpPublishUrl, sourceUrl } = await this.getInstallDataWithSourceUrl(
      cameraId,
      projectId,
      userId,
      user
    )
    // RTMP 推流需要 H264+AAC；用 ffmpeg 來源並指定 codec 以確保 publish 到 mediamtx 成功
    const streamLine = sourceUrl?.trim()
      ? `    - ffmpeg:${sourceUrl.trim().replace(/\n/g, ' ')}#video=h264#audio=aac`
      : '    - rtsp://YOUR_CAMERA_IP:554/stream1  # 請改為現場攝影機 RTSP，推流建議改為 ffmpeg:rtsp://...#video=h264#audio=aac'
    return `# go2rtc 設定檔 - ${streamToken}
# 下載後與本資料夾內的執行腳本一起使用，執行腳本會自動下載 go2rtc 並啟動
# 若與 mediamtx 同機，改用 8556 避免與 mediamtx 的 RTSP 埠 8554 衝突
rtsp:
  listen: ":8556"

# publish 的 key 必須與 streams 的 stream 名稱相同；stream 用 ffmpeg 轉 H264+AAC 以符合 RTMP 推流
publish:
  ${streamToken}:
    - ${rtmpPublishUrl}

streams:
  ${streamToken}:
${streamLine}
`
  },

  /**
   * 產出專案層級 go2rtc.yaml（含此專案所有攝影機的 stream；每次下載為當前最新 token）
   */
  async getInstallYamlContentForProject(projectId: string, userId: string, user: AuthUser): Promise<string> {
    await ensureUserCanAccessProject(projectId, userId, user.systemRole === 'platform_admin')
    const base = MEDIAMTX_PUBLIC_HOST.replace(/\/$/, '')
    const hostForRtmp = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '')
    const rtmpPort = process.env.MEDIAMTX_RTMP_PORT?.trim() || '1935'
    const rows = await cameraRepository.findByProjectIdWithSourceEnc(projectId)
    if (rows.length === 0) {
      return `# go2rtc 設定檔 - 此專案尚無攝影機
# 請先在系統中新增攝影機後，重新下載安裝包
rtsp:
  listen: ":8556"

publish: {}
streams: {}
`
    }
    const publishLines: string[] = []
    const streamLines: string[] = []
    for (const row of rows) {
      const rtmpPublishUrl = `rtmp://${hostForRtmp}:${rtmpPort}/${row.streamToken}`
      publishLines.push(`  ${row.streamToken}:\n    - ${rtmpPublishUrl}`)
      const sourceUrl = row.sourceUrlEnc ? encryption.decrypt(row.sourceUrlEnc) : null
      const streamLine = sourceUrl?.trim()
        ? `    - ffmpeg:${sourceUrl.trim().replace(/\n/g, ' ')}#video=h264#audio=aac`
        : '    - rtsp://YOUR_CAMERA_IP:554/stream1  # 請改為此台攝影機的 RTSP，推流建議改為 ffmpeg:rtsp://...#video=h264#audio=aac'
      streamLines.push(`  ${row.streamToken}:\n${streamLine}`)
    }
    return `# go2rtc 設定檔 - 本專案 ${rows.length} 台攝影機
# 下載後與本資料夾內的執行腳本一起使用。Mac 請雙擊 run.command；Windows 請雙擊 run.bat
# 執行前腳本會自動關閉先前已開啟的 go2rtc，再從 GitHub 下載最新版並啟動
rtsp:
  listen: ":8556"

# publish 的 key 必須與 streams 的 stream 名稱相同
publish:
${publishLines.join('\n')}

streams:
${streamLines.join('\n')}
`
  },

  /** 一鍵安裝包：依 os 產出 run.bat（Windows）或 run.sh（Mac）內容；執行前會先結束既有 go2rtc */
  buildRunScript(os: 'win' | 'mac'): string {
    const ver = GO2RTC_VERSION
    const baseUrl = `https://github.com/AlexxIT/go2rtc/releases/download/v${ver}`
    if (os === 'win') {
      return `@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 檢查並關閉先前執行的 go2rtc...
taskkill /F /IM go2rtc.exe 2>nul
if %errorlevel% equ 0 (echo 已關閉先前的 go2rtc.) else (echo 無須關閉.)
echo.
echo 正在下載 go2rtc ...
if not exist go2rtc.exe (
  curl -fsSL -o go2rtc.zip "${baseUrl}/go2rtc_${ver}_windows_amd64.zip"
  if errorlevel 1 (
    echo 下載失敗。請用瀏覽器開啟並手動下載：
    echo   ${baseUrl}/go2rtc_${ver}_windows_amd64.zip
    pause
    exit /b 1
  )
  tar -xf go2rtc.zip
  for /d %%i in (go2rtc_*) do ( copy "%%i\\go2rtc.exe" . & rd /s /q "%%i" )
  del go2rtc.zip 2>nul
)
echo 啟動 go2rtc（推流至雲端）...
go2rtc.exe
pause
`
    }
    const macScript = `#!/bin/bash
# 若 Mac 顯示「無法打開」：請對本檔按右鍵 → 開啟 → 再點「開啟」一次即可。
# 腳本執行後會自動清除隔離屬性，之後雙擊即可執行。
set -e
cd "$(dirname "$0")"
# 清除 Mac 隔離屬性，避免「無法打開」或 Killed: 9（解壓或下載的檔案被 Gatekeeper 阻擋時）
xattr -cr . 2>/dev/null || true
echo "檢查並關閉先前執行的 go2rtc..."
pkill -x go2rtc 2>/dev/null || true
lsof -ti:1984 | xargs kill -9 2>/dev/null || true
echo "無須關閉或已關閉先前的 go2rtc."
echo ""
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) SUFFIX="mac_arm64";;
  *) SUFFIX="mac_amd64";;
esac
BIN="go2rtc"
if [ ! -x "$BIN" ]; then
  echo "正在下載 go2rtc ..."
  if ! curl -fsSL -o go2rtc.zip "${baseUrl}/go2rtc_${'$'}{SUFFIX}.zip"; then
    echo "下載失敗（可能為網路或 GitHub 存取問題）。請用瀏覽器開啟："
    echo "  ${baseUrl}/go2rtc_${'$'}{SUFFIX}.zip"
    echo "下載後將 zip 放至此資料夾，重新執行此腳本。"
    exit 1
  fi
  if ! unzip -o go2rtc.zip; then
    echo "解壓失敗，下載的檔案可能不完整。請用瀏覽器手動下載上述網址的 zip 並解壓至此資料夾，再執行此腳本。"
    rm -f go2rtc.zip
    exit 1
  fi
  mv go2rtc_${'$'}{SUFFIX}/go2rtc . 2>/dev/null || true
  chmod +x go2rtc
  xattr -cr go2rtc 2>/dev/null || true
  rm -rf go2rtc.zip go2rtc_mac_*
fi
echo "啟動 go2rtc（推流至雲端）..."
./go2rtc
`
    return macScript
  },

  /** 產出一鍵安裝 zip（含 go2rtc.yaml + Windows 或 Mac 執行腳本）— 單一攝影機用 */
  async getInstallPackage(
    cameraId: string,
    projectId: string,
    userId: string,
    user: AuthUser,
    os: 'win' | 'mac'
  ): Promise<Buffer> {
    const yamlContent = await this.getInstallYamlContent(cameraId, projectId, userId, user)
    const runScript = this.buildRunScript(os)
    const runFileName = os === 'win' ? 'run.bat' : 'run.sh'
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const archive = archiver('zip', { zlib: { level: 9 } })
      archive.on('error', reject)
      const collector = new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk)
          cb()
        },
        final(cb) {
          resolve(Buffer.concat(chunks))
          cb()
        },
      })
      archive.pipe(collector)
      archive.append(yamlContent, { name: 'go2rtc.yaml' })
      archive.append(runScript, { name: runFileName })
      if (os === 'mac') {
        archive.append(runScript, { name: 'run.command' })
        archive.append(MAC_README, { name: 'Mac安裝說明.txt' })
      }
      archive.finalize()
    })
  },

  /**
   * 產出專案層級一鍵安裝 zip（含本專案所有攝影機的 go2rtc.yaml + run 腳本；Mac 含 run.command 可雙擊）
   */
  async getInstallPackageForProject(
    projectId: string,
    userId: string,
    user: AuthUser,
    os: 'win' | 'mac'
  ): Promise<Buffer> {
    const yamlContent = await this.getInstallYamlContentForProject(projectId, userId, user)
    const runScript = this.buildRunScript(os)
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const archive = archiver('zip', { zlib: { level: 9 } })
      archive.on('error', reject)
      const collector = new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk)
          cb()
        },
        final(cb) {
          resolve(Buffer.concat(chunks))
          cb()
        },
      })
      archive.pipe(collector)
      archive.append(yamlContent, { name: 'go2rtc.yaml' })
      archive.append(runScript, { name: os === 'win' ? 'run.bat' : 'run.sh' })
      if (os === 'mac') {
        archive.append(runScript, { name: 'run.command' })
        archive.append(MAC_README, { name: 'Mac安裝說明.txt' })
      }
      archive.finalize()
    })
  },
}
