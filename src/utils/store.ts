import type { EvmOperationQuery, EvmOperationRecord, EvmOperationStore, EvmOperationStatus } from '../types.js'

function matchesStatus(record: EvmOperationRecord, status?: EvmOperationStatus | EvmOperationStatus[]): boolean {
  if (!status) return true
  return Array.isArray(status) ? status.includes(record.status) : record.status === status
}

function matchesQuery(record: EvmOperationRecord, query: EvmOperationQuery = {}): boolean {
  return (
    (!query.kind || record.kind === query.kind) &&
    matchesStatus(record, query.status) &&
    (!query.chainId || record.chainId === query.chainId) &&
    (!query.tradeId || record.tradeId === query.tradeId) &&
    (!query.swapId || record.swapId === query.swapId)
  )
}

export class MemoryOperationStore implements EvmOperationStore {
  private readonly records = new Map<string, EvmOperationRecord>()

  async get(id: string): Promise<EvmOperationRecord | null> {
    return this.records.get(id) ?? null
  }

  async put(record: EvmOperationRecord): Promise<void> {
    this.records.set(record.id, record)
  }

  async putIfAbsent(record: EvmOperationRecord): Promise<boolean> {
    if (this.records.has(record.id)) return false
    this.records.set(record.id, record)
    return true
  }

  async list(query: EvmOperationQuery = {}): Promise<EvmOperationRecord[]> {
    return [...this.records.values()].filter(record => matchesQuery(record, query))
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }
}
