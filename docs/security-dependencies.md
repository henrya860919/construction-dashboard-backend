# 依賴資安說明

## npm audit 現狀

執行 `npm audit` 可能仍會顯示若干漏洞，主要來自 **Prisma 7** 的間接依賴（如 `@prisma/dev` → Hono、@hono/node-server），以及 **bcrypt** 建置時使用的 `tar`。本專案 **production 執行時使用 Express**，未使用 Hono；Prisma 僅用於 ORM 與 CLI，因此這些漏洞對實際對外服務的風險有限。

## 已採取的措施

- **package.json overrides**：強制 `tar` ≥ 7.5.11、`lodash` ≥ 4.17.21，以修補可安全升級的間接依賴。
- 定期執行 `npm audit`，並關注 [Prisma 釋出](https://github.com/prisma/prisma/releases) 與 [bcrypt](https://github.com/kelektiv/node.bcrypt.js) 的安全更新。

## 若欲徹底消除 audit 警告

需接受 breaking change：執行 `npm audit fix --force` 會將 Prisma 降版至 6.x，需配合程式與 migration 調整並完整回歸測試。建議待 Prisma 7 上游更新依賴後再升級，而非強制降版。
