import type { CallerScope, Records } from './conversations.js'
import type { WorkTarget } from './work.js'
export const settingFields = ['adapter', 'model', 'effort'] as const
export type SettingField = (typeof settingFields)[number]
export type Values = Partial<Record<SettingField, string>>
export type SettingsTarget = {
  kind: 'organization' | 'agent' | 'installation-agent'
  id: string
}
export type SettingPatch = Partial<
  Record<SettingField, { set: string } | { clear: true }>
> & { instructions?: { set: string } }
export interface SettingsRecord {
  id: string
  revision: number
  target: SettingsTarget
  values: Values
  options: Record<string, unknown>
  instructions?: string
}
export interface EffectiveSettings {
  id: string
  revision: number
  agentId: string
  organizationId: string | null
  values: Values
  sources: Partial<
    Record<SettingField, 'organization' | 'agent' | 'installation-agent'>
  >
  instructions: string
  reasons: string[]
}
export interface Catalog {
  revision: number
  refreshedAt: string
  stale: boolean
  adapters: {
    id: string
    name: string
    available: boolean
    reason: string
    capabilities: string[]
    models: {
      id: string
      name: string
      available: boolean
      reason: string
      efforts: string[]
    }[]
  }[]
}
export interface InboxNotification {
  id: string
  revision: number
  recipientId: string
  target: WorkTarget
  resourceId: string
  kind: 'completion' | 'question' | 'approval' | 'failure' | 'recovery-needed'
  title: string
  createdAt: string
  read: boolean
}
export interface SettingsOperation {
  operationId: string
  target: CallerScope
  action: 'settings'
  resource: SettingsTarget
  patch: SettingPatch
}
export interface ReadOperation {
  operationId: string
  target: CallerScope
  action: 'read'
  notificationId: string
}
export type ControlOperation = SettingsOperation | ReadOperation
export type ControlReceipt =
  | { operationId: string; status: 'unknown' }
  | {
      operationId: string
      target: CallerScope
      operation: ControlOperation
      status: 'accepted' | 'rejected'
      message: string
      records: Records
    }
export interface ControlClient {
  command(
    operation: ControlOperation,
    signal: AbortSignal,
  ): Promise<ControlReceipt>
  receipt(
    operation: ControlOperation,
    signal: AbortSignal,
  ): Promise<ControlReceipt>
  read(scope: CallerScope, signal: AbortSignal): Promise<Records>
  catalog(scope: CallerScope, signal: AbortSignal): Promise<Catalog>
}
export function sameScope(a: CallerScope, b: CallerScope) {
  return a?.installationId === b.installationId && a?.callerId === b.callerId
}
export function settingsId(target: SettingsTarget) {
  return `${target.kind}:${target.id}`
}
export function effectiveId(agentId: string, organizationId: string | null) {
  return JSON.stringify(['effective', agentId, organizationId])
}

/** Semantic identity is independent of JSON property order. */
export function sameControlIdentity(
  a: ControlOperation | undefined,
  b: ControlOperation,
) {
  if (
    !a ||
    a.operationId !== b.operationId ||
    !sameScope(a.target, b.target) ||
    a.action !== b.action
  )
    return false
  return a.action === 'settings' && b.action === 'settings'
    ? a.resource?.kind === b.resource.kind && a.resource?.id === b.resource.id
    : a.action === 'read' &&
        b.action === 'read' &&
        a.notificationId === b.notificationId
}
