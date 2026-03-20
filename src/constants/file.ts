/**
 * 檔案上傳常數，與前端對齊
 */

/** 影像管理／圖庫（對應權限模組 `construction.photo`） */
export const FILE_CATEGORY_PHOTO = 'photo'

export const CHUNKED_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024 // 5MB
export const CHUNKED_UPLOAD_MAX_TOTAL_BYTES = 50 * 1024 * 1024 // 50MB
export const CHUNKED_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024 // 2MB
export const CHUNKED_UPLOAD_EXPIRY_HOURS = 24

/** 傳統上傳單檔上限（若 Tenant 未設定則用此預設，單位 bytes） */
export const UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES = 50 * 1024 * 1024 // 50MB
