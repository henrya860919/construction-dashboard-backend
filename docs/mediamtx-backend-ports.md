# 後端與 mediamtx Port 對照與設定

## 一、Port 總表（誰聽、誰連、要不要對外）

| Port | 誰在聽 | 誰來連 | 要不要對外 | 說明 |
|------|--------|--------|------------|------|
| **9997** | mediamtx | **Backend** | ❌ 不必 | Backend 用內網網址連 mediamtx API（新增/刪除 path、查 path 列表）。 |
| **8889** | mediamtx | **前端（瀏覽器）** | ✅ 要 | WebRTC / WHEP 播放，前端需要能連到這個 port。 |
| **1935** | mediamtx | **go2rtc（現場）** | ✅ 要（TCP Proxy） | RTMP 推流，go2rtc publish 用 rtmp://host:port/<token> 推上來。 |
| **8189** | mediamtx | **前端（瀏覽器）** | 視情況 | ICE TCP，WebRTC 連線用；Railway 有開才穩。 |

---

## 二、誰連誰（一句話）

```
Backend  --內網 9997-->  mediamtx API（path 管理）
前端     --公網 8889-->  mediamtx WebRTC（播放）
go2rtc   --公網 1935-->  mediamtx RTMP（推流）
```

---

## 三、Backend 環境變數（後端要設的）

| 變數 | 值要填什麼 | 誰用 |
|------|------------|------|
| `MEDIAMTX_API_URL` | mediamtx 的**內網** API 網址 | Backend 自己連 mediamtx 用 |
| `MEDIAMTX_PUBLIC_HOST` | mediamtx 的**對外**網址（給瀏覽器連 8889） | 給前端組 WHEP URL、給安裝包說明用 |
| `MEDIAMTX_RTMP_PUBLIC_URL` | RTMP 的**對外** URL（給 go2rtc publish 推流） | 安裝包裡 go2rtc 的 rtmp:// 用；go2rtc publish 不支援外網 RTSP |

### 正確範例（Railway 同專案）

- **MEDIAMTX_API_URL**  
  `http://<mediamtx 服務名稱>.railway.internal:9997`  
  例：`http://mediamtx.railway.internal:9997` 或你實際的服務名 `http://satisfied-love.railway.internal:9997`  
  → 重點：**服務名稱**要跟 Railway 裡 mediamtx 那台服務的 **Settings 裡顯示的名稱一致**。

- **MEDIAMTX_PUBLIC_HOST**  
  mediamtx 對外網址，且**要能連到 8889**。  
  例：`https://mediamtx-xxx.up.railway.app`（Railway 上這個 domain 要指到 **port 8889**，不是 9997）。

- **MEDIAMTX_RTMP_PUBLIC_URL**  
  RTMP 對外完整 URL（port 1935）。go2rtc publish 只支援 RTMP/RTMPS。  
  例：`rtmp://shuttle.proxy.rlwy.net:1935`（Railway 需開 TCP Proxy 對應容器 1935）。

---

## 四、mediamtx 服務在 Railway 要怎麼開 Port

| 目的 | 在 mediamtx 服務的 Networking 怎麼設 |
|------|--------------------------------------|
| 讓 Backend 連 API | **不用**對外開 9997，Backend 用**內網** `xxx.railway.internal:9997`。 |
| 讓前端播放 | **Public HTTP** 的 domain 要指到 **8889**（不是 9997）。 |
| 讓 go2rtc 推流 | **TCP Proxy**：選一個對外 port（如 1935），對應容器內 **1935**（RTMP）。 |

---

## 五、出現「串流服務無法連線，請確認 mediamtx 已啟動（port 9997）」時

代表 **Backend 連不到 MEDIAMTX_API_URL**。請依序查：

1. **MEDIAMTX_API_URL 的 host 是否為 mediamtx 的「服務名稱」**  
   - 到 Railway 專案 → 點 **mediamtx 那台服務** → **Settings** 頂部或 **Networking** 看 **Private Network** 的 hostname。  
   - 應為 `xxx.railway.internal`，其中 `xxx` 就是服務名稱。  
   - Backend 的 `MEDIAMTX_API_URL` 必須是 `http://<這個名稱>.railway.internal:9997`。

2. **Backend 和 mediamtx 是否在同一個 Railway 專案**  
   - 不同專案的話，`.railway.internal` 不通，Backend 無法用內網連 mediamtx。

3. **mediamtx 服務是否有正常跑**  
   - 在 Railway 看 mediamtx 的 **Deployments**，確認沒有 crash、有在 run。

4. **mediamtx 是否有開 9997**  
   - 我們的 `mediamtx.yml` 有 `api: true`、`apiAddress: ":9997"`，容器內會聽 9997；不需對外暴露 9997。

---

## 六、快速對照：你填的 vs 應該的

| 你現在（可能） | 建議 |
|----------------|------|
| MEDIAMTX_API_URL = `http://satisfied-love.railway.internal:9997` | 若 mediamtx 那台服務名稱就是 `satisfied-love`，這樣對。若服務名稱是別的（例如 `mediamtx`），要改成 `http://mediamtx.railway.internal:9997`。 |
| Public HTTP 指到 9997 | 前端播放需要 **8889**。請在 mediamtx 服務把 **對外 domain 指到 port 8889**，或另開一個指到 8889。 |
| MEDIAMTX_RTSP_PUBLIC_HOST | go2rtc publish 不支援外網 RTSP，請改用 **MEDIAMTX_RTMP_PUBLIC_URL** = `rtmp://shuttle.proxy.rlwy.net:1935`。 |

---

*文件版本：1.0　2026年3月*
