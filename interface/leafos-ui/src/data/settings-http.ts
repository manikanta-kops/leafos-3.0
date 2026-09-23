import type {
  ControlClient,
  ControlOperation,
  ControlReceipt,
  Catalog,
} from './settings.js'
import { sameScope, sameControlIdentity } from './settings.js'
import { parseRecords } from './conversation-http.js'
export function createControlClient(endpoint: string): ControlClient {
  async function request(path: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(`${endpoint}/conversations/settings/${path}`, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok)
      throw new Error(
        `Settings and inbox service unavailable (HTTP ${response.status}).`,
      )
    return response.json()
  }
  async function receipt(
    path: string,
    op: ControlOperation,
    signal: AbortSignal,
  ): Promise<ControlReceipt> {
    const v = await request(path, op, signal)
    if (v?.operationId !== op.operationId)
      throw new Error('Invalid operation receipt.')
    if (v.status === 'unknown') return v
    if (
      !['accepted', 'rejected'].includes(v.status) ||
      !sameScope(v.target, op.target) ||
      !sameControlIdentity(v.operation, op) ||
      typeof v.message !== 'string'
    )
      throw new Error('Invalid operation scope.')
    return { ...v, records: parseRecords(v.records) }
  }
  return {
    command: (op, signal) => receipt('command', op, signal),
    receipt: (op, signal) => receipt('receipt', op, signal),
    read: async (scope, signal) =>
      parseRecords(await request('read', scope, signal)),
    async catalog(scope, signal): Promise<Catalog> {
      const v = await request('catalog', scope, signal)
      if (
        !Number.isSafeInteger(v?.revision) ||
        !Number.isFinite(Date.parse(v.refreshedAt)) ||
        typeof v.stale !== 'boolean' ||
        !Array.isArray(v.adapters) ||
        !v.adapters.every(
          (a: Catalog['adapters'][number]) =>
            typeof a.id === 'string' &&
            typeof a.name === 'string' &&
            typeof a.available === 'boolean' &&
            typeof a.reason === 'string' &&
            Array.isArray(a.capabilities) &&
            a.capabilities.every((x) => typeof x === 'string') &&
            Array.isArray(a.models) &&
            a.models.every(
              (m) =>
                typeof m.id === 'string' &&
                typeof m.name === 'string' &&
                typeof m.available === 'boolean' &&
                typeof m.reason === 'string' &&
                Array.isArray(m.efforts) &&
                m.efforts.every((x) => typeof x === 'string'),
            ),
        )
      )
        throw new Error('Invalid adapter catalog.')
      return v
    },
  }
}
