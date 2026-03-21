# 攝影機串流管道：邏輯、技術與踩坑紀錄

> 本文整理「現場攝影機 → go2rtc → mediamtx（雲端）→ 瀏覽器 WebRTC 播放」整條管線的**架構邏輯**、**技術要點**、**我們踩過的坑**，以及**未來可能再發生的問題**。  
> 寫於 2026 年 3 月，對應本專案現有實作。

---

## 一、整條管線在幹嘛（邏輯）

### 1.1 一句話

**現場電腦上的 go2rtc 把攝影機的 RTSP 串流，用 RTMP 推到 Railway 的 mediamtx；使用者在瀏覽器透過 WebRTC（WHEP）從 mediamtx 拉畫面。**

### 1.2 資料流與角色

```
┌─────────────────┐     RTSP      ┌─────────────┐     RTMP       ┌─────────────┐     WHEP/WebRTC    ┌─────────────┐
│  現場攝影機      │ ──────────►  │  go2rtc     │ ───────────►  │  mediamtx   │ ◄────────────────  │  瀏覽器     │
│  (或 NVR 等)     │  拉取串流     │  (現場電腦)  │  推流到雲端    │  (Railway)   │   播放畫面         │  (Vercel)   │
└─────────────────┘               └─────────────┘               └──────┬──────┘                    └─────────────┘
                                                                        │
                                                                        │ 內網 API (9997)
                                                                        ▼
                                                                 ┌─────────────┐
                                                                 │  Backend    │  管理 path、產出安裝包
                                                                 │  (Railway)  │  (go2rtc.yaml 內含 rtmp:// 推流網址)
                                                                 └─────────────┘
```

- **go2rtc（現場）**：從攝影機 **拉** RTSP，再依設定 **推** 到 mediamtx。推流協定只能是 **RTMP/RTMPS**（不支援「推到外網 RTSP」）。
- **mediamtx（雲端）**：收 RTMP 推流、對外提供 WebRTC/WHEP 播放；並提供 REST API（9997）給 Backend 做 path 管理。
- **Backend**：建立/刪除攝影機時呼叫 mediamtx API 新增/移除 path；產出給現場用的 **go2rtc.yaml**（內含 `publish` 的 rtmp 網址、streams 的 ffmpeg source）。
- **前端**：向 mediamtx 發 WHEP 請求、用回傳的 SDP 建立 WebRTC 連線並顯示畫面。

### 1.3 關鍵協定對照

| 區段 | 協定 | 用途 |
|------|------|------|
| 攝影機 → go2rtc | RTSP | 現場設備拉流（go2rtc 當 client） |
| go2rtc → mediamtx | **RTMP** | 現場推流到雲端（go2rtc publish 只支援 RTMP/RTMPS） |
| 瀏覽器 → mediamtx | WHEP / WebRTC | 播放端拉流（HTTP POST 取 SDP，再建 PeerConnection） |

---

## 二、技術含量與設計要點

### 2.1 WebRTC / WHEP 端（前端 ↔ mediamtx）

- **WHEP**：瀏覽器對 mediamtx 的 `POST /<path>/whep`，body 為 offer SDP，回應為 answer SDP。
- **SDP / ICE**：answer 必須含 **session-level** 的 `a=ice-ufrag`、`a=ice-pwd`（Pion 要求 bundled ICE）；行尾須為 **CRLF**（RFC 4566）。
- **STUN**：mediamtx 在雲端需要 STUN 才能得知自己外網 IP，SDP 裡才會有可連的 candidate。
- **TCP ICE**：Railway 上 UDP 常不穩，mediamtx 需開 `webrtcLocalTCPAddress`（如 `:8189`），讓 WebRTC 可走 TCP。
- **前端**：只做一次 WHEP POST 取 answer，不依賴 mediamtx 的 reader.js（避免跨域 PATCH 送錯 origin）；offer 可加 `addTransceiver('video', { direction: 'recvonly' })` 確保有 video 段。

### 2.2 go2rtc 推流端（現場 → mediamtx）

- **publish 只認 RTMP/RTMPS**：寫成 `rtsp://外網:port/token` 會報 `unsupported scheme: rtsp://`，必須用 `rtmp://...`。
- **安裝包網址從哪來**：Backend 依環境變數 **MEDIAMTX_RTMP_PUBLIC_URL** 組出 `rtmp://host:port/<streamToken>` 寫進 go2rtc.yaml；**沒設就會 fallback 成 localhost**，正式環境一定要在 Railway Backend 設此變數。
- **AVCC 錯誤**：mediamtx 收 RTMP 時若遇到 H.264 封裝不當，會出現 `unable to decode AVCC: access unit size too big` 等。解法是 **streams 用 ffmpeg source**（`ffmpeg:rtsp://...#video=h264#audio=aac`），由 ffmpeg 重新封裝，與「用 RTMP 推流」是兩件事。

### 2.3 mediamtx 設定檔（YAML）

- **webrtc** 在 mediamtx 裡是**布林**（`true`/`false`），不是物件。若寫成：
  ```yaml
  webrtc:
    iceServers: ...
  ```
  會出現 **`json: cannot unmarshal object into Go value of type bool`**。
- 正確寫法為**頂層扁平鍵**：`webrtc: true`，並用 `webrtcICEServers2`、`webrtcLocalTCPAddress` 等。

### 2.4 Backend 與 mediamtx 的互動

- **MEDIAMTX_API_URL**：Backend 連 mediamtx 用，必須是 **內網**（如 `http://<mediamtx 服務名>.railway.internal:9997`）。填成對外網址會連不到或延遲大。
- **MEDIAMTX_PUBLIC_HOST**：給**前端**組 WHEP URL 用（對外、port 8889）。
- **MEDIAMTX_RTMP_PUBLIC_URL**：給**安裝包內 go2rtc** 的 publish 用（對外、port 1935），例如 `rtmp://xxx.proxy.rlwy.net:1935`。
- **API 逾時**：cameras list/getById 會呼叫 mediamtx 的 `/v3/paths/list` 取即時狀態。若沒設逾時，mediamtx 掛掉或網路有問題時，這兩支 API 會等很久；因此我們在 `src/lib/mediamtx.ts` 對 mediamtx 的 fetch 加了 **5 秒逾時**（可調 `MEDIAMTX_API_TIMEOUT_MS`）。

### 2.5 Port 總表（誰聽、誰連）

| Port | 誰在聽 | 誰來連 | 對外 | 說明 |
|------|--------|--------|------|------|
| 9997 | mediamtx | Backend | 否 | Control API：path 新增/刪除、paths list |
| 8889 | mediamtx | 瀏覽器 | 是 | WebRTC / WHEP 播放 |
| 1935 | mediamtx | go2rtc | 是（TCP Proxy） | RTMP 推流 |
| 8189 | mediamtx | 瀏覽器（ICE） | 視情況 | WebRTC TCP ICE，Railway 建議開 |

---

## 三、踩過的坑與對應解法

### 坑 1：`SetRemoteDescription called with no ice-ufrag`

- **現象**：前端或 mediamtx 日誌出現此錯誤，畫面不來。
- **原因**：answer SDP 沒有有效的 session-level ICE（ice-ufrag/ice-pwd），或 mediamtx 在雲端沒正確初始化 ICE（沒 STUN、沒開 webrtc 等）。
- **解法**：
  - mediamtx 設 **STUN**（`webrtcICEServers2`）、必要時 **webrtcLocalTCPAddress**；`webrtc: true`。
  - 前端**不要**自己亂補假的 ice-ufrag 到 answer；應直接用 mediamtx 回傳的 SDP，問題在伺服器端設定。

### 坑 2：go2rtc 報 `unsupported scheme: rtsp://...`

- **現象**：安裝包內 publish 寫成 `rtsp://外網:port/token`，go2rtc 啟動或推流時報錯。
- **原因**：go2rtc 的 **publish 只支援 RTMP/RTMPS** 作為推流目標，不支援「推到外網 RTSP」。
- **解法**：publish URL 一律改為 **RTMP**，由 Backend 用 **MEDIAMTX_RTMP_PUBLIC_URL** 組出 `rtmp://host:port/<token>` 寫入 go2rtc.yaml；mediamtx 對外開 1935（TCP Proxy）。

### 坑 3：mediamtx 日誌 `unable to decode AVCC: access unit size too big` / `invalid length`

- **現象**：RTMP 有連上，但 mediamtx 解 H.264 失敗。
- **原因**：go2rtc 從攝影機拉來的 RTSP 經 RTMP 推上去時，H.264 以 AVCC 形式出問題（長度欄位或封裝不當）。
- **解法**：**與推流協定無關**。在 go2rtc 的 **streams** 改用 **ffmpeg source**：`ffmpeg:rtsp://攝影機網址#video=h264#audio=aac`，讓 ffmpeg 重新封裝再給 go2rtc 推 RTMP。

### 坑 4：mediamtx 啟動報 `json: cannot unmarshal object into Go value of type bool`

- **現象**：mediamtx 部署或啟動時連續報此錯誤。
- **原因**：`mediamtx.yml` 裡把 **webrtc** 寫成物件（底下 iceServers、iceTCPMuxAddress），但 mediamtx 預期 **webrtc 是布林**。
- **解法**：改成 `webrtc: true`，ICE 相關改為頂層鍵：`webrtcICEServers2`、`webrtcLocalTCPAddress`（見專案內 `docker/mediamtx/mediamtx.yml`）。

### 坑 5：Backend 報 503「串流服務無法連線」/ fetch mediamtx 失敗

- **現象**：建立攝影機或查 path 時 Backend 連不到 mediamtx。
- **原因**：**MEDIAMTX_API_URL** 填成對外網址或錯的 host，或 Backend 與 mediamtx 不在同一 Railway 專案。
- **解法**：MEDIAMTX_API_URL 設為 **內網** `http://<mediamtx 服務名稱>.railway.internal:9997`，且兩服務在同一專案；確認 mediamtx 有正常跑、聽 9997。

### 坑 6：cameras list 或 get 單筆攝影機 API 很慢

- **現象**：打 `/projects/xxx/cameras` 或 `/projects/xxx/cameras/:id` 要等很久才回。
- **原因**：這兩支會呼叫 mediamtx 的 `getRuntimePathsList()`；若 mediamtx 無回應，**fetch 沒設逾時**會一直等到底層 TCP 逾時。
- **解法**：在 `src/lib/mediamtx.ts` 對 mediamtx 的 request 加 **AbortController + 5 秒逾時**；逾時後 API 仍回傳，只是 connectionStatus 依 lastStreamAt 等判斷（可能顯示離線）。

### 坑 7：正式環境下載的 go2rtc.yaml 裡還是 `rtmp://localhost:1935/...`

- **現象**：在正式站下載的安裝包，publish 仍是 localhost。
- **原因**：Backend 在 **Railway 上沒設 MEDIAMTX_RTMP_PUBLIC_URL**，程式 fallback 成本機 `rtmp://localhost:1935/<token>`。
- **解法**：在 Railway Backend 的 **Variables** 新增 **MEDIAMTX_RTMP_PUBLIC_URL** = `rtmp://你的mediamtx對外主機:port`（例如 Railway TCP Proxy 給 1935 的那組網址），重新部署後再下載安裝包。

---

## 四、未來可能再發生的問題與注意點

### 4.1 環境變數漏設或填錯

- **MEDIAMTX_RTMP_PUBLIC_URL** 沒設 → 安裝包永遠是 localhost。
- **MEDIAMTX_API_URL** 填成對外或錯的服務名 → Backend 連不到 mediamtx，503 或 cameras API 慢/失敗。
- **MEDIAMTX_PUBLIC_HOST** 指錯 port（指到 9997 而非 8889）→ 前端 WHEP 連錯埠，播放失敗。

**建議**：部署檢查清單或 CI 中列明這三項；新環境部署時對照 `docs/mediamtx-backend-ports.md`、`docs/deployment-setup-guide.md`。

### 4.2 Railway 網路與 WebRTC

- **UDP 不穩**：若只靠 UDP，可能偶發連不上或斷線；已用 **webrtcLocalTCPAddress** 補強。
- **TURN**：若使用者網路極嚴格（例如部分企業防火牆），STUN + TCP 仍可能失敗，屆時需考慮 TURN 中繼（mediamtx 的 webrtc 可加 TURN 到 iceServers）。

### 4.3 go2rtc / mediamtx 升級

- **go2rtc**：publish 若未來支援 RTSP 目標，可再評估是否改回 RTSP 推流；目前以 RTMP 為準。
- **mediamtx**：YAML 欄位或 API 路徑可能變更，升級時需對照官方 [Configuration file reference](https://mediamtx.org/docs/references/configuration-file)、[WebRTC](https://mediamtx.org/docs/other/webrtc-specific-features)。

### 4.4 攝影機 / 編碼相容性

- 部分攝影機的 RTSP 輸出（編碼、封裝）仍可能觸發 mediamtx 解碼錯誤；若出現類似 AVCC 的錯誤，優先檢查 **streams 是否已改為 ffmpeg source**，必要時加 `#video=h264#audio=aac` 或調整 ffmpeg 參數。

### 4.5 多區域 / 多 mediamtx

- 若未來有多個 mediamtx 實例（例如多區部署），Backend 需能依攝影機或專案決定連哪一個 mediamtx（API URL、RTMP 對外 URL、PUBLIC_HOST），目前架構為單一 mediamtx。

---

## 五、相關文件與程式位置

| 項目 | 位置 |
|------|------|
| mediamtx 設定範例 | `docker/mediamtx/mediamtx.yml` |
| Backend 呼叫 mediamtx（含逾時） | `src/lib/mediamtx.ts` |
| 安裝包 YAML 與 RTMP URL 組裝 | `src/modules/camera/camera.service.ts`（getRtmpPublishUrl、getInstallConfig、getInstallYamlContent 等） |
| 前端 WHEP 播放 | 前端專案 `src/composables/useWhepPlayer.ts` |
| Port 與環境變數對照 | `docs/mediamtx-backend-ports.md` |
| WebRTC 錯誤排查 | `docs/mediamtx-webrtc-troubleshooting.md` |
| 部署步驟與變數說明 | `docs/deployment-setup-guide.md`（5.4～5.6） |

---

*文件版本：1.0　2026 年 3 月*
