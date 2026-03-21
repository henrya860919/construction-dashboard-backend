import { AppError } from '../../shared/errors.js'

/** 接受使用者輸入字串（可含千分位逗號），回傳可寫入 Decimal 欄位之字串 */
export function normalizeDecimalInput(s: string, fieldLabel: string): string {
  const t = s.trim().replace(/,/g, '')
  if (t === '') {
    throw new AppError(400, 'BAD_REQUEST', `${fieldLabel} 不可為空`)
  }
  const n = Number(t)
  if (!Number.isFinite(n)) {
    throw new AppError(400, 'BAD_REQUEST', `${fieldLabel} 必須為有效數字`)
  }
  return t
}
