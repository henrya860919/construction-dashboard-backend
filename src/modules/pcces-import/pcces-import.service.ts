import { AppError } from '../../shared/errors.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { fileService } from '../file/file.service.js'
import { FILE_CATEGORY_PCCES_XML } from '../../constants/file.js'
import { parsePccesXmlBuffer } from './pcces-xml-parser.js'
import { pccesImportRepository } from './pcces-import.repository.js'

/** 明細頁一次載入全部工項之上限（避免超大型 XML 拖垮記憶體） */
const PCCES_ITEMS_LIST_ALL_MAX = 100_000

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

function serializeImport(row: {
  id: string
  projectId: string
  version: number
  documentType: string | null
  fileName: string
  attachmentId: string | null
  itemCount: number
  generalCount: number
  createdAt: Date
  createdById: string
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    documentType: row.documentType,
    fileName: row.fileName,
    attachmentId: row.attachmentId,
    itemCount: row.itemCount,
    generalCount: row.generalCount,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
  }
}

export const pccesImportService = {
  async list(projectId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'read')
    const rows = await pccesImportRepository.listByProject(projectId)
    return rows.map(serializeImport)
  },

  async getById(projectId: string, importId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'read')
    const row = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    return serializeImport(row)
  },

  async listItems(
    projectId: string,
    importId: string,
    user: AuthUser,
    query: { page: number; limit: number; skip: number; itemKind?: string; all?: boolean }
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'read')
    const parent = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!parent) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')

    const whereKind =
      query.itemKind === 'general' || query.itemKind === 'mainItem' ? query.itemKind : undefined

    const total = await pccesImportRepository.countItems(importId, whereKind)

    if (query.all) {
      if (total > PCCES_ITEMS_LIST_ALL_MAX) {
        throw new AppError(
          400,
          'PCCES_ITEMS_TOO_MANY',
          `此匯入工項超過 ${PCCES_ITEMS_LIST_ALL_MAX} 筆，無法一次載入，請聯絡管理員`
        )
      }
    }

    const skip = query.all ? 0 : query.skip
    const take = query.all ? total : query.limit

    const rows = await pccesImportRepository.listItems(importId, {
      skip,
      take,
      itemKind: whereKind,
    })

    const items = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      parentItemKey: r.parentItemKey,
      itemNo: r.itemNo,
      itemKind: r.itemKind,
      refCode: r.refCode,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      amountImported: r.amountImported,
      remark: r.remark,
      percent: r.percent,
      path: r.path,
      depth: r.depth,
    }))

    return {
      import: serializeImport(parent),
      items,
      meta: query.all
        ? { page: 1, limit: total, total }
        : { page: query.page, limit: query.limit, total },
    }
  },

  async uploadFromBuffer(
    projectId: string,
    buffer: Buffer,
    originalFileName: string,
    mimeType: string,
    user: AuthUser
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'create')

    const lower = originalFileName.toLowerCase()
    if (!lower.endsWith('.xml')) {
      throw new AppError(400, 'BAD_REQUEST', '請上傳 .xml 檔案')
    }

    const { documentType, rows } = await parsePccesXmlBuffer(buffer)

    const created = await pccesImportRepository.createImportWithItems(
      projectId,
      user.id,
      originalFileName,
      documentType,
      rows,
      null
    )

    try {
      const att = await fileService.uploadFile(
        buffer,
        originalFileName,
        mimeType || 'application/xml',
        projectId,
        user.id,
        user,
        { category: FILE_CATEGORY_PCCES_XML, businessId: created.id }
      )
      await pccesImportRepository.updateAttachmentId(created.id, att.id)
    } catch {
      // 歸檔失敗不阻擋匯入；attachmentId 維持 null
    }

    const withAtt = await pccesImportRepository.findByIdForProject(projectId, created.id)
    return serializeImport(withAtt ?? created)
  },

  async softDelete(projectId: string, importId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'delete')
    const result = await pccesImportRepository.softDeleteImport(projectId, importId, user.id)
    if (!result) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    if (result.attachmentId) {
      try {
        await fileService.delete(result.attachmentId, user.id, user)
      } catch {
        // 匯入與工項已軟刪；歸檔檔刪除失敗不阻擋（避免 R2／競態導致整體失敗）
      }
    }
  },
}
