# 本機網路存取說明（Local / 本機 IP 皆可連線）

本文件說明為何後端除了 `localhost` 外，也可以用**本機 IP**（例如 `192.168.x.x`）正常連線與運作，並在 **npm run dev** 時前後端都顯示 Local / Network 存取網址。

---

## 1. 伺服器綁定：`0.0.0.0`

後端在 `src/index.ts` 啟動時使用：

```ts
const HOST = process.env.HOST ?? '0.0.0.0'
app.listen(Number(PORT), HOST, () => { ... })
```

第二個參數 **`'0.0.0.0'`** 表示：

- 監聽**所有網路介面**，不限定本機迴環（loopback）。
- 因此可接受來自：
  - `http://localhost:3003`、`http://127.0.0.1:3003`（本機）
  - `http://<你的區域網 IP>:3003`（同一網段的其他裝置，例如手機、另一台電腦）

若改為只綁定本機，例如：

- `app.listen(PORT)`（不傳 host），或
- `app.listen(PORT, '127.0.0.1')`

則**僅接受來自本機**的連線，用本機 IP 從其他裝置連線會無法連上。

---

## 2. 環境變數 HOST

可透過後端 **`.env`** 設定 `HOST`（預設 `0.0.0.0`），例如：

```env
HOST=0.0.0.0
```

若只希望本機連線，可設 `HOST=127.0.0.1`。

---

## 3. 前端用本機 IP 開啟時：CORS 需放行

前端若以 `http://<你的 IP>:5175` 開啟，發送 API 請求時，瀏覽器會帶上 `Origin: http://<你的 IP>:5175`。後端 CORS 必須允許該 origin，請求才不會被瀏覽器擋下。

在後端 **`.env`** 中設定 `CORS_ORIGIN`（逗號分隔多個來源），例如：

```env
# 本機 + 你的 IP（把手機要用的那台電腦 IP 加進來）
CORS_ORIGIN=http://localhost:5175,http://192.168.0.33:5175
```

- 若你的本機 IP 為 `192.168.0.33`，就加入 `http://192.168.0.33:5175`。
- 若你的 IP 不同，請在 `.env` 加入 `http://<你的 IP>:5175`。IP 會變時記得更新並重啟後端。

---

## 4. 本機 IP 如何取得（getNetworkIPs）

後端啟動時顯示的「Network」網址來自 `src/utils/network.ts` 的 **`getNetworkIPs()`**：

- 使用 Node.js 內建 **`os.networkInterfaces()`**，取得本機所有網路介面及其位址。
- 只保留 **IPv4**（`address.family === 'IPv4'`）。
- 排除 **內部／迴環** 位址（`!address.internal`），因此不會列出 `127.0.0.1`，只會得到對外的區域網 IP（例如 `192.168.x.x`）。

```ts
// src/utils/network.ts（節錄）
import os from 'node:os'

export function getNetworkIPs(): string[] {
  const interfaces = os.networkInterfaces()
  const ips: string[] = []
  for (const _name of Object.keys(interfaces)) {
    const addresses = interfaces[_name]
    if (addresses) {
      for (const address of addresses) {
        if (address.family === 'IPv4' && !address.internal) {
          ips.push(address.address)
        }
      }
    }
  }
  return [...new Set(ips)]
}
```

---

## 5. 啟動時顯示 Access URLs

### 5.1 後端（Express）

- **綁定所有介面**：`app.listen(PORT, '0.0.0.0', callback)`（或 `env.HOST`）。
- **取得本機 IP**：在 `listen` 的 callback 裡呼叫 `getNetworkIPs()`。
- **印出 Local / Network**：在 `src/index.ts` 的 callback 內用 `console.log` 輸出。

執行 **npm run dev**（或啟動後端）後，終端會看到：

```
🚀 Server is running!
📍 Access URLs:
   Local:    http://localhost:3003
   Local:    http://127.0.0.1:3003
   Network:  http://192.168.x.x:3003
```

### 5.2 前端（Vite）

- **綁定所有介面**：在 `vite.config.ts` 的 `server` 與 `preview` 設 **`host: true`**，等同綁定 `0.0.0.0`。
- **印出網址**：Vite 內建會在 **npm run dev** 或 **npm run preview** 啟動時自動印出 **Local** 與 **Network** 網址，不需額外程式。

```ts
// 前端 vite.config.ts（節錄）
server: {
  port: 5175,
  host: true,
  // ...
},
preview: {
  port: 5175,
  host: true,
  // ...
},
```

執行 **npm run dev** 後，終端會出現類似：

```
  ➜  Local:   http://localhost:5175/
  ➜  Network: http://192.168.x.x:5175/
```

**若前端沒有出現 Network 那一行**：請確認 `server.host` 與 `preview.host` 為 `true`。

---

## 6. 前端 .env：VITE_API_URL 用本機 IP

用手機開前端時，API 請求會發到 `VITE_API_URL`。請在前端 **`.env`** 設成你電腦的 IP，例如：

```env
VITE_API_URL=http://192.168.0.33:3003
```

---

## 7. 總結

| 項目                           | 說明                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| **為何可用本機 IP 連後端**     | `app.listen(PORT, '0.0.0.0')` 綁定在所有介面上，接受本機與區網連線。                               |
| **為何前端用 IP 開也能打 API** | 後端 CORS 的 `CORS_ORIGIN` 須包含前端的 origin（例如 `http://<IP>:5175`）。                        |
| **啟動時顯示的欄位**           | 後端：`src/index.ts` 用 `getNetworkIPs()` 印出 Local / Network；前端：Vite `host: true` 自動印出。 |
| **若只希望本機連線**           | 後端設 `HOST=127.0.0.1`，CORS 僅放行 `http://localhost:5175`。                                     |
