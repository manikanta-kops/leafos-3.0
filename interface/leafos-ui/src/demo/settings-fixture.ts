import type { WorkspaceSnapshot } from '../data/workspace-client.js'
import type { PreviewData, ChatContext } from '../features/chat/model.js'
import {
  emptyRecords,
  type Records,
  type CallerScope,
} from '../data/conversations.js'
import {
  effectiveId,
  settingsId,
  settingFields,
  type Catalog,
  type SettingsRecord,
  type EffectiveSettings,
  type InboxNotification,
  type ControlOperation,
  type ControlReceipt,
  type SettingsTarget,
} from '../data/settings.js'
/** In-memory simulation only. Core must persist settings, instruction files and inbox. */
export function settingsFixture(
  state: WorkspaceSnapshot,
  data: PreviewData,
  publish: (r: Records) => void,
) {
  let version = 1
  let catalog: Catalog = {
    revision: 1,
    refreshedAt: new Date().toISOString(),
    stale: false,
    adapters: [
      {
        id: 'fixture:codex',
        name: 'Codex simulation',
        available: true,
        reason: '',
        capabilities: ['streaming', 'steering', 'questions'],
        models: [
          {
            id: 'fixture:balanced',
            name: 'Balanced simulation',
            available: true,
            reason: '',
            efforts: ['low', 'high'],
          },
          {
            id: 'fixture:quick',
            name: 'Quick simulation',
            available: true,
            reason: '',
            efforts: [],
          },
        ],
      },
      {
        id: 'fixture:alternate',
        name: 'Alternate simulation',
        available: true,
        reason: '',
        capabilities: ['streaming'],
        models: [
          {
            id: 'fixture:careful',
            name: 'Careful simulation',
            available: true,
            reason: '',
            efforts: ['deliberate'],
          },
        ],
      },
    ],
  }
  const settings = new Map<string, SettingsRecord>()
  const notifications = new Map<string, InboxNotification>()
  const receipts = new Map<string, ControlReceipt>()
  const deliveries: ControlOperation[] = []
  function ensure() {
    for (const org of state.organizations) {
      const target: SettingsTarget = { kind: 'organization', id: org.id }
      if (!settings.has(settingsId(target)))
        settings.set(settingsId(target), {
          id: settingsId(target),
          revision: version,
          target,
          values: {
            adapter: 'fixture:codex',
            model: 'fixture:balanced',
            effort: 'low',
          },
          options: { preserved: 'fixture-option' },
          instructions: org.instructions ?? '',
        })
      const existing = settings.get(settingsId(target))!
      if (existing.instructions !== (org.instructions ?? '')) {
        existing.instructions = org.instructions ?? ''
        existing.revision = ++version
      }
    }
    for (const actor of Object.values(state.actorsById).filter(
      (a) => a.kind === 'agent',
    )) {
      const root = state.agentRoles.some((r) => r.agentId === actor.id)
      const target: SettingsTarget = {
        kind: root ? 'installation-agent' : 'agent',
        id: actor.id,
      }
      if (!settings.has(settingsId(target)))
        settings.set(settingsId(target), {
          id: settingsId(target),
          revision: version,
          target,
          values: root
            ? {
                adapter: 'fixture:codex',
                model: 'fixture:balanced',
                effort: 'low',
              }
            : {},
          options: { preserved: 'fixture-agent-option' },
        })
    }
  }
  function effective(agentId: string, context: ChatContext): EffectiveSettings {
    ensure()
    const orgId =
      context.kind === 'organization' ? context.organizationId : null
    const root = state.agentRoles.some((r) => r.agentId === agentId)
    const agent = settings.get(
      `${root || orgId === null ? 'installation-agent' : 'agent'}:${agentId}`,
    )
    const org =
      orgId && !root ? settings.get(`organization:${orgId}`) : undefined
    const result: EffectiveSettings = {
      id: effectiveId(agentId, orgId),
      revision: version,
      agentId,
      organizationId: orgId,
      values: {},
      sources: {},
      instructions: org?.instructions ?? '',
      reasons: [],
    }
    for (const key of settingFields) {
      const value = agent?.values[key] ?? org?.values[key]
      if (value) {
        result.values[key] = value
        result.sources[key] = agent?.values[key]
          ? root || orgId === null
            ? 'installation-agent'
            : 'agent'
          : 'organization'
      }
    }
    const adapter = catalog.adapters.find((a) => a.id === result.values.adapter)
    const model = adapter?.models.find((m) => m.id === result.values.model)
    if (!adapter)
      result.reasons.push(
        result.values.adapter
          ? 'Saved adapter is missing from the catalog.'
          : 'Choose an execution adapter.',
      )
    else if (!adapter.available)
      result.reasons.push(adapter.reason || 'Saved adapter is unavailable.')
    if (!model)
      result.reasons.push(
        result.values.model
          ? 'Saved model is incompatible with this adapter or missing.'
          : 'Choose a model.',
      )
    else {
      if (!model.available)
        result.reasons.push(model.reason || 'Saved model is unavailable.')
      if (result.values.effort && !model.efforts.includes(result.values.effort))
        result.reasons.push('Saved effort is not supported by this model.')
    }
    return result
  }
  function projection(callerId: string): Records {
    ensure()
    const effectiveRows = state.memberships
      .filter((m) => state.actorsById[m.actorId]?.kind === 'agent')
      .map((m) =>
        effective(m.actorId, {
          kind: 'organization',
          organizationId: m.organizationId,
        }),
      )
    for (const role of state.agentRoles)
      effectiveRows.push(
        effective(role.agentId, {
          kind: 'installation',
          installationId: state.installationId,
        }),
      )
    return structuredClone({
      ...emptyRecords(),
      settings: [...settings.values()],
      effective: effectiveRows,
      notifications: [...notifications.values()].filter(
        (n) => n.recipientId === callerId,
      ),
    })
  }
  function observe(records: Records): InboxNotification[] {
    const added: InboxNotification[] = []
    const add = (
      id: string,
      kind: InboxNotification['kind'],
      title: string,
      resourceId: string,
      target: InboxNotification['target'],
    ) => {
      if (notifications.has(id)) return
      const n: InboxNotification = {
        id,
        revision: 1,
        recipientId: target.callerId,
        target: structuredClone(target),
        resourceId,
        kind,
        title,
        createdAt: new Date().toISOString(),
        read: false,
      }
      notifications.set(id, n)
      added.push(n)
    }
    for (const a of records.work?.attempts ?? []) {
      if (['completed', 'failed', 'recovery-needed'].includes(a.state))
        add(
          `attempt:${a.id}:${a.state}`,
          a.state === 'completed'
            ? 'completion'
            : a.state === 'failed'
              ? 'failure'
              : 'recovery-needed',
          a.state === 'completed'
            ? 'Work completed'
            : a.state === 'failed'
              ? 'Work failed'
              : 'Work needs recovery',
          a.id,
          a.target,
        )
    }
    for (const i of records.work?.interactions ?? [])
      if (i.state === 'pending')
        add(
          `interaction:${i.id}:${i.attemptId}:${i.version}`,
          i.kind,
          i.kind === 'question'
            ? 'Your answer is needed'
            : 'Your approval is needed',
          i.id,
          i.target,
        )
    return added
  }
  function serve(
    path: string,
    v: ControlOperation & CallerScope & { catalog?: Catalog },
  ) {
    ensure()
    const scope = 'target' in v ? v.target : v
    if (path === 'catalog') return structuredClone(catalog)
    if (path === 'read') return projection(scope.callerId)
    if (path === 'inspect')
      return {
        deliveries,
        receipts: [...receipts.values()],
        ...projection(scope.callerId),
      }
    if (path === 'catalog-test' && v.catalog) {
      catalog = structuredClone(v.catalog)
      version++
      publish(projection(scope.callerId))
      return catalog
    }
    const key = JSON.stringify([scope.callerId, v.operationId])
    if (path === 'receipt')
      return (
        receipts.get(key) ?? { status: 'unknown', operationId: v.operationId }
      )
    if (path !== 'command') throw new Error('Unknown operation')
    deliveries.push(structuredClone(v))
    if (receipts.has(key)) return receipts.get(key)
    let error = ''
    if (typeof v.operationId !== 'string' || !v.operationId)
      throw new Error('Operation ID required')
    if (v.action === 'read') {
      const item = notifications.get(v.notificationId)
      if (!item || item.recipientId !== scope.callerId)
        error = 'This notification is unavailable.'
      else if (!item.read) {
        item.read = true
        item.revision++
      }
    } else if (v.action === 'settings') {
      const item = settings.get(settingsId(v.resource))
      if (!item) error = 'The captured settings target is unavailable.'
      else if (
        !v.patch ||
        Object.entries(v.patch).some(
          ([k, val]) =>
            ![...settingFields, 'instructions'].includes(k) ||
            !val ||
            typeof val !== 'object' ||
            Object.keys(val).length !== 1 ||
            ('set' in val
              ? typeof val.set !== 'string' ||
                (k !== 'instructions' && !val.set.trim())
              : !('clear' in val) ||
                val.clear !== true ||
                (item.target.kind === 'organization' && k !== 'effort') ||
                k === 'instructions') ||
            (k === 'instructions' && item.target.kind !== 'organization'),
        )
      )
        error =
          'Choose valid changed fields. Only agent overrides or the optional organization effort can be cleared.'
      else {
        for (const k of settingFields) {
          const change = v.patch[k]
          if (change) {
            if ('set' in change) item.values[k] = change.set
            else delete item.values[k]
          }
        }
        if (v.patch.instructions) {
          item.instructions = v.patch.instructions.set
          const org = state.organizations.find((o) => o.id === item.target.id)
          if (org) org.instructions = item.instructions
        }
        item.revision = ++version
      }
    } else error = 'Unsupported operation.'
    const receipt: ControlReceipt = {
      operationId: v.operationId,
      operation: structuredClone(v),
      target: scope,
      status: error ? 'rejected' : 'accepted',
      message:
        error ||
        (v.action === 'read'
          ? 'Marked read.'
          : 'Settings saved. New simulated executions use these values.'),
      records: projection(scope.callerId),
    }
    receipts.set(key, structuredClone(receipt))
    publish(receipt.records)
    return receipt
  }
  return {
    serve,
    projection,
    observe,
    effective,
    execution(threadId: string) {
      const chat = data.chatsById[data.threadsById[threadId].chatId]
      const agent = chat.participantIds.find(
        (id) => state.actorsById[id]?.kind === 'agent',
      )!
      return { simulated: true as const, ...effective(agent, chat.context) }
    },
  }
}
