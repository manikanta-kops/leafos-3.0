import { sameWorkTarget } from './work-target.js'
import type { WorkClient, WorkReceipt, WorkOperation } from './work.js'
import { parseRecords } from './conversation-http.js'
import { ConversationError } from './conversations.js'
export function createWorkClient(endpoint: string): WorkClient {
  async function request(
    path: string,
    operation: WorkOperation,
    signal: AbortSignal,
  ): Promise<WorkReceipt> {
    const response = await fetch(`${endpoint}/conversations/work/${path}`, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation),
    })
    if (!response.ok)
      throw new ConversationError(
        `Work service unavailable (HTTP ${response.status}).`,
      )
    const v = await response.json()
    if (v?.operationId !== operation.operationId)
      throw new ConversationError(
        'Work receipt identity is invalid.',
        'malformed',
      )
    if (v.status === 'unknown')
      return { status: 'unknown', operationId: operation.operationId }
    if (
      !['accepted', 'rejected'].includes(v.status) ||
      !sameWorkTarget(v.target, operation.target) ||
      typeof v.message !== 'string'
    )
      throw new ConversationError(
        'Work receipt target is invalid.',
        'malformed',
      )
    return { ...v, records: parseRecords(v.records) }
  }
  return {
    command: (op, signal) => request('command', op, signal),
    receipt: (op, signal) => request('receipt', op, signal),
  }
}
