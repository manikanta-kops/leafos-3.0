import type { Records } from './conversations.js'
import { settingFields } from './settings.js'
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => typeof v === 'string' && !!v
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const values = (v: unknown) =>
  object(v) && settingFields.every((k) => v[k] === undefined || text(v[k]))
export function parseSettingsRecords(
  v: Record<string, unknown>,
): Pick<Records, 'settings' | 'effective' | 'notifications' | 'attention'> {
  const check = (
    key: string,
    test: (r: Record<string, unknown>) => boolean,
  ) => {
    if (
      v[key] !== undefined &&
      (!Array.isArray(v[key]) ||
        !v[key].every(
          (r) => object(r) && text(r.id) && revision(r.revision) && test(r),
        ))
    )
      throw new Error(`Invalid ${key} projection.`)
  }
  check(
    'settings',
    (r) =>
      object(r.target) &&
      ['organization', 'agent', 'installation-agent'].includes(
        String(r.target.kind),
      ) &&
      text(r.target.id) &&
      values(r.values) &&
      object(r.options) &&
      (r.instructions === undefined || typeof r.instructions === 'string'),
  )
  check(
    'effective',
    (r) =>
      text(r.agentId) &&
      (r.organizationId === null || text(r.organizationId)) &&
      values(r.values) &&
      object(r.sources) &&
      Object.values(r.sources).every((s) =>
        ['organization', 'agent', 'installation-agent'].includes(String(s)),
      ) &&
      typeof r.instructions === 'string' &&
      Array.isArray(r.reasons) &&
      r.reasons.every((x) => typeof x === 'string'),
  )
  check(
    'notifications',
    (r) =>
      text(r.recipientId) &&
      object(r.target) &&
      text(r.target.installationId) &&
      r.target.callerId === r.recipientId &&
      text(r.target.chatId) &&
      text(r.target.threadId) &&
      object(r.target.context) &&
      (r.target.context.kind === 'organization'
        ? text(r.target.context.organizationId)
        : r.target.context.kind === 'installation' &&
          r.target.context.installationId === r.target.installationId) &&
      text(r.resourceId) &&
      [
        'completion',
        'question',
        'approval',
        'failure',
        'recovery-needed',
      ].includes(String(r.kind)) &&
      text(r.title) &&
      typeof r.read === 'boolean' &&
      Number.isFinite(Date.parse(String(r.createdAt))),
  )
  if (
    v.attention !== undefined &&
    (!Array.isArray(v.attention) || !v.attention.every(text))
  )
    throw new Error('Invalid attention identities.')
  return {
    settings: v.settings,
    effective: v.effective,
    notifications: v.notifications,
    attention: v.attention,
  } as Pick<Records, 'settings' | 'effective' | 'notifications' | 'attention'>
}
