/**
 * 語意化 API 錯誤，由 service 拋出，由 error-handler middleware 轉成 { error: { code, message } }。
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
    Object.setPrototypeOf(this, AppError.prototype)
  }
}
