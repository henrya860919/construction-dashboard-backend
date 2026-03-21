# mediamtx WebRTC 連線問題完整排查指南

> 寫給不熟悉 WebRTC 的開發者  
> 適用場景：Vue 3 前端（Vercel）+ mediamtx（Railway）+ go2rtc（現場）

---

## 先看懂整條連線的流程

在排查問題之前，先搞清楚「一個畫面出現在瀏覽器上」中間發生了什麼事：

```
Step 1：go2rtc（現場電腦）主動連到 Railway 的 mediamtx
        → 把攝影機的 RTSP 串流推進去

Step 2：前端（Vercel）打開播放頁面
        → 對 mediamtx 發一個 POST 請求（WHEP 協議）
        → 說「我要看這個攝影機」

Step 3：mediamtx 回傳一個 answer SDP
        → SDP 裡面包含「要怎麼連線」的資訊
        → 包含 ICE 資訊（用來打洞、建立連線的憑證）

Step 4：前端用這個 answer 建立 WebRTC 連線
        → 影像開始傳輸
        → 瀏覽器顯示畫面
```

任何一個 Step 失敗，畫面就不會出現。

---

## 名詞解釋（小白版）

| 名詞 | 白話解釋 |
|------|---------|
| WebRTC | 讓瀏覽器可以直接播放即時影像的技術，不需要安裝外掛 |
| WHEP | 前端跟 mediamtx 說「我要看串流」的方式，就是一個 HTTP POST |
| SDP | 連線的「說明書」，裡面寫了要用哪個 IP、哪個 Port、什麼格式 |
| ICE | 負責找到雙方可以連通的路徑，類似「打洞」 |
| ice-ufrag | ICE 的身份識別碼，用來配對雙方的連線 |
| ice-pwd | ICE 的密碼，確認雙方是同一個 session |
| STUN | 幫 mediamtx 找到自己的外網 IP 的工具，Google 有提供免費的 |
| TURN | 當直連失敗時，改由第三方伺服器中繼影像 |
| candidate | ICE 候選路徑，可能是內網 IP、外網 IP、或 TURN 伺服器 |

---

## 錯誤訊息對照表

### 錯誤一：`SetRemoteDescription called with no ice-ufrag`

**白話意思：**  
mediamtx 回傳的連線說明書（answer SDP）裡面，身份識別碼是空的，前端沒辦法用這份說明書建立連線。

**根本原因：**  
mediamtx 在雲端環境沒有正確初始化 ICE，通常是因為：

1. `mediamtx.yml` 沒有設定 `webrtc` 區塊
2. mediamtx 不知道自己的外網 IP
3. 串流根本不存在（沒有 go2rtc 推流進來）

**不是前端的問題，是伺服器設定問題。**

**錯誤的處理方式：**
```typescript
// ❌ 這樣做只是掩蓋問題，不是解決問題
const sdp = ensureIceInSdp(body)  // 補假的 ice-ufrag
await pc.setRemoteDescription(...)
// 雖然不報錯，但連線還是建不起來
```

**正確的處理方式：**
```typescript
// ✅ 直接用 mediamtx 回傳的原始 answer
// 如果還是沒有 ice-ufrag，去修 mediamtx.yml
await pc.setRemoteDescription(
  new RTCSessionDescription({ type: 'answer', sdp: body })
)
```

**解法：** 修 `mediamtx.yml`，加上 STUN 設定（見下方）

---

### 錯誤二：`ICE connection failed` 或 `connectionState: failed`

**白話意思：**  
連線說明書沒問題，但實際建立連線的時候失敗了。兩端找不到可以互通的路徑。

**常見原因：**

- **原因 A：** mediamtx 報告的是內網 IP（10.x.x.x）→ Vercel 上的前端用內網 IP 去連 → 當然連不到
- **原因 B：** Railway 的防火牆擋了 UDP → WebRTC 預設走 UDP，被擋就連不了
- **原因 C：** 沒有設定 STUN，mediamtx 不知道自己的外網 IP → SDP 裡只有內網 IP，沒有外網 IP

**解法：**
```yaml
# mediamtx.yml 加上 STUN
webrtc:
  iceServers:
    - url: stun:stun.l.google.com:19302
  iceTCPMuxAddress: ":8189"  # Railway UDP 不穩，改走 TCP
```

---

### 錯誤三：`HTTP 404` 或 `HTTP 500` 在打 WHEP

**白話意思：**  
前端去跟 mediamtx 要串流，但 mediamtx 說找不到或出錯了。

**常見原因：**

- **404：** 這個 camera token 的串流不存在 → go2rtc 還沒推流進來，或 token 名稱打錯
- **500：** mediamtx 內部錯誤 → WebRTC 模組初始化失敗，通常是設定問題

**確認方式：**
```bash
# 打這個 API 確認串流是否存在
GET https://你的railway網址:9997/v3/paths/list

# 回傳內容裡面找你的 camera token
# ready: true 才代表有串流進來
```

---

### 錯誤四：`session not found` 在 PATCH 請求

**白話意思：**  
前端想要更新連線資訊，但 mediamtx 說這個 session 不存在。

**原因：**  
mediamtx 的官方 `reader.js` 在跨網域環境（Vercel + Railway）會把 PATCH 請求的 URL 算錯，送到 Vercel 的 origin 而不是 Railway。

**解法：**  
不要用 mediamtx 的 `reader.js`，改用手動 WHEP（只做 POST 取 answer，不做 PATCH）。本專案已採用手動 WHEP。

---

### 錯誤五：畫面一直轉圈，沒有錯誤訊息

**白話意思：**  
沒有明確報錯，但畫面就是出不來。

**最常見的原因：**

- **原因 A：** ICE gathering 卡住了 → 前端在等 ICE candidate 收集完成，但等不到 complete
- **原因 B：** WebRTC 連線建立中，但影像沒有到達 → connectionState 是 connected，但 ontrack 沒觸發

**解法：** 加超時機制（等 ICE 最多 5 秒）、加連線狀態監控（onconnectionstatechange / onicegatheringstatechange）。本專案已實作。

---

## 本機 vs 雲端差異

| 環境 | 說明 |
|------|------|
| **本機** | mediamtx 和瀏覽器在同一個網路，直接用內網 IP 連，不需要打洞，沒有防火牆問題 |
| **雲端（Railway + Vercel）** | mediamtx 在 Railway、瀏覽器在不同網路，需要 STUN 找外網 IP、防火牆開放 Port、ICE 打洞 |

---

## 正確的 mediamtx.yml 完整設定

```yaml
# mediamtx.yml（Railway 部署用）

api: true
apiAddress: ":9997"

webrtcAllowOrigins: ['*']

webrtc:
  iceServers:
    - url: stun:stun.l.google.com:19302
    - url: stun:stun1.l.google.com:19302
  iceTCPMuxAddress: ":8189"

  # 如果 TCP 還是不通，可加 TURN（影像走中繼）
  # iceServers 再加：
  #   - url: turn:openrelay.metered.ca:80
  #     username: openrelayproject
  #     credential: openrelayproject

authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: publish
        path:
      - action: read
        path:
      - action: playback
        path:
  - user: any
    pass:
    ips: []
    permissions:
      - action: api
      - action: metrics
      - action: pprof
```

---

## Railway 必須開放的 Port

| Port | 用途 |
|------|------|
| TCP 9997 | mediamtx REST API（Backend 呼叫） |
| TCP 8889 | WebRTC WHEP 端點（前端播放） |
| TCP 8554 | RTSP（go2rtc 推流進來） |
| TCP 8189 | ICE TCP（讓 ICE 走 TCP） |
| UDP 8189 | ICE UDP（若 Railway 支援可開） |

> Railway 預設只開 TCP；若 UDP 開不了，用 `iceTCPMuxAddress` 強制走 TCP 即可。

---

## 除錯步驟（照順序做）

1. **確認串流有沒有進來**  
   打 `GET .../v3/paths/list`，找 camera token，確認 `ready: true`。

2. **確認 answer SDP 有沒有 ice-ufrag**  
   看前端 Console 的 `[WHEP] has ice-ufrag:`。若為 `false` → 修 mediamtx.yml 並重新部署；若為 `true` → 再往下查。

3. **確認 RTCPeerConnection 狀態**  
   看 `connectionState`：`connected` 但沒畫面 → 查 ontrack；`failed` → 查 Railway Port / STUN / TURN。

4. **仍不通可試 TURN**  
   在 mediamtx.yml 的 `webrtc.iceServers` 加上 TURN（如 openrelay.metered.ca）。

5. **若 Railway 一直有問題**  
   可考慮 Fly.io、Render 或自架 VPS（DigitalOcean / Vultr）。

---

## 常見錯誤和解法速查

| 錯誤訊息 | 原因 | 解法 |
|---------|------|------|
| `no ice-ufrag` | mediamtx answer SDP 沒有 ICE 資訊 | 修 mediamtx.yml 加 webrtc + STUN |
| `ICE connection failed` | 雙方找不到可連通的路徑 | 確認 Railway Port、加 TURN |
| `HTTP 404` | 串流不存在 | 確認 go2rtc 有推流、token 正確 |
| `session not found` | reader.js 跨網域 PATCH 送錯 | 改用手動 WHEP（本專案已用） |
| 畫面轉圈不報錯 | ICE gathering 卡住或超時 | 加 5 秒超時、狀態監控（本專案已有） |
| `connectionState: failed` | ICE 最終失敗 | 加 STUN/TURN、確認 Port |

---

## 技術原理補充（選讀）

### 為什麼本機不需要 STUN？

本機上 mediamtx 和瀏覽器在同一個局域網，用內網 IP 就能直接連。雲端上 mediamtx 在 VM 裡只知內網 IP，瀏覽器連不到；STUN 讓 mediamtx 知道自己的外網 IP，才能讓瀏覽器連到它。

### 為什麼 Railway 的 UDP 會有問題？

WebRTC 預設走 UDP（延遲低），但 Railway 對 UDP 支援不穩。改用 `iceTCPMuxAddress` 讓 ICE 走 TCP，穩定性較好。

### ensureIceInSdp 的用途

- **對 offer（送給 mediamtx）：** 可補 session-level ice，讓 Pion 能解析；本專案僅在送 offer 時使用 `ensureIceInSdp(offerSdp, true)`。
- **對 answer（mediamtx 回傳）：** 不可用假 ICE 補上，否則雙方 credentials 對不上，連線建不起來；本專案已改為直接用原始 `body`。

### go2rtc 推流：RTSP 取代 RTMP（雲端建議）

雲端部署時，go2rtc 改以 **RTSP**（port 8554）推流至 mediamtx，可避免 RTMP 的 AVCC 解析錯誤（`access unit size ... is too big`）。本專案安裝包與 Backend 已改為產出 `rtsp://host:8554/<token>`；Railway 需對 mediamtx 開放 **TCP 8554**（或加 TCP Proxy）。

---

## 本專案目前實作對照

| 項目 | 指南建議 | 目前實作 | 狀態 |
|------|----------|----------|------|
| answer 不加工 | 直接用 mediamtx 回傳的原始 answer | `setRemoteDescription({ type: 'answer', sdp: body })` | ✅ 一致 |
| 除錯 log | 確認 answer 有無 ice-ufrag | `console.log('[WHEP] answer SDP:', body)`、`console.log('[WHEP] has ice-ufrag:', ...)` | ✅ 有 |
| 手動 WHEP | 不用 reader.js，只 POST 取 answer | 一律手動 WHEP（mediamtx 跨網域時不載入 reader） | ✅ 一致 |
| ICE 超時 | 等 ICE 最多 5 秒 | `Promise.race([...onicegatheringstatechange..., setTimeout(5000)])` | ✅ 一致 |
| 連線失敗提示 | onconnectionstatechange 偵測 failed | `peerConn.connectionState === 'failed'` 時設 error 訊息 | ✅ 一致 |
| STUN（前端） | RTCPeerConnection 帶 STUN | `iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]` | ✅ 一致 |
| addTransceiver | video recvonly | `pc.addTransceiver('video', { direction: 'recvonly' })` | ✅ 一致 |
| mediamtx.yml webrtc | STUN + iceTCPMuxAddress | `webrtc.iceServers`（Google STUN）+ `iceTCPMuxAddress: ":8189"` | ✅ 一致 |

**結論：** 前端與 mediamtx 設定皆已依本指南實作；若仍出現 no ice-ufrag，請確認 mediamtx 已用含 `webrtc` 區塊的 yml 重新部署，且 Railway 有開放 TCP 8189。

---

*文件版本：1.0　2026年3月　適用：Vue 3 + mediamtx + Railway + Vercel*
