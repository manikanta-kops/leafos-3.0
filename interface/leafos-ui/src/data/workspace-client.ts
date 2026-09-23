import { createControlClient } from './settings-http.js'
import type { ControlClient } from './settings.js'
import { createMediaClient, type MediaClient } from './media.js'
import { createWorkClient } from './work-http.js'
import type { WorkClient } from './work.js'
import { createConversationClient } from './conversation-http.js'
import type { ConversationClient } from './conversations.js'
import { createFixtureManagement } from './management-http.js'
import type { WorkspaceManagement } from './management.js'
import type { PreviewData } from '../features/chat/model.js'

/** UI-side discovery projection. This is not a published Core wire contract. */
export type WorkspaceSnapshot = Pick<
  PreviewData,
  | 'installationId'
  | 'currentHumanId'
  | 'actorsById'
  | 'agentRoles'
  | 'organizations'
  | 'memberships'
  | 'groups'
  | 'groupAssignments'
>

export interface WorkspaceClient {
  /** Includes the normalized destination, not only a reusable profile name. */
  readonly connectionKey: string
  readonly management?: WorkspaceManagement
  readonly controls?: ControlClient
  readonly media?: MediaClient
  readonly work?: WorkClient
  readonly conversations?: ConversationClient
  readonly fixture: boolean
  readonly configurationError?: {
    code: 'missing-endpoint' | 'invalid-endpoint' | 'unsupported-scheme'
    message: string
  }
  readWorkspace(signal: AbortSignal): Promise<WorkspaceSnapshot>
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
function list(
  value: unknown,
  check: (item: Record<string, unknown>) => boolean,
) {
  return (
    Array.isArray(value) && value.every((item) => record(item) && check(item))
  )
}

/** Validate the provisional projection before records reach rendering or persistence. */
export function parseWorkspace(value: unknown): WorkspaceSnapshot {
  const invalid = () => {
    throw new Error('The workspace response is invalid or incompatible.')
  }
  if (
    !record(value) ||
    !text(value.installationId) ||
    !text(value.currentHumanId) ||
    !record(value.actorsById)
  )
    return invalid()
  const actors = value.actorsById
  if (
    !Object.entries(actors).every(
      ([id, actor]) =>
        record(actor) &&
        actor.id === id &&
        text(actor.name) &&
        (actor.kind === 'human' ||
          (actor.kind === 'agent' &&
            typeof actor.description === 'string' &&
            text(actor.color) &&
            (actor.instructions === undefined ||
              typeof actor.instructions === 'string'))),
    )
  )
    return invalid()
  const caller = actors[value.currentHumanId]
  const isAgent = (id: string) => {
    const actor = actors[id]
    return record(actor) && actor.kind === 'agent'
  }
  if (
    !record(caller) ||
    caller.kind !== 'human' ||
    !list(
      value.organizations,
      (o) =>
        text(o.id) &&
        text(o.name) &&
        (o.description === undefined || typeof o.description === 'string') &&
        (o.instructions === undefined || typeof o.instructions === 'string'),
    ) ||
    !list(
      value.memberships,
      (m) => text(m.id) && text(m.organizationId) && text(m.actorId),
    ) ||
    !list(
      value.groups,
      (g) => text(g.id) && text(g.organizationId) && text(g.name),
    ) ||
    !list(
      value.groupAssignments,
      (a) => text(a.groupId) && text(a.membershipId),
    ) ||
    !list(
      value.agentRoles,
      (r) => r.role === 'root-admin' && text(r.agentId) && isAgent(r.agentId),
    )
  )
    return invalid()
  const snapshot = value as unknown as WorkspaceSnapshot
  for (const entries of [
    snapshot.organizations,
    snapshot.memberships,
    snapshot.groups,
  ]) {
    if (new Set(entries.map((item) => item.id)).size !== entries.length)
      return invalid()
  }
  if (
    new Set(
      snapshot.memberships.map((m) =>
        JSON.stringify([m.organizationId, m.actorId]),
      ),
    ).size !== snapshot.memberships.length ||
    new Set(
      snapshot.groupAssignments.map((a) =>
        JSON.stringify([a.groupId, a.membershipId]),
      ),
    ).size !== snapshot.groupAssignments.length
  )
    return invalid()
  const orgs = new Set(snapshot.organizations.map((o) => o.id))
  if (
    snapshot.memberships.some(
      (m) => !orgs.has(m.organizationId) || !actors[m.actorId],
    ) ||
    snapshot.groups.some((g) => !orgs.has(g.organizationId)) ||
    snapshot.groupAssignments.some((a) => {
      const group = snapshot.groups.find((g) => g.id === a.groupId)
      const member = snapshot.memberships.find((m) => m.id === a.membershipId)
      return !group || !member || group.organizationId !== member.organizationId
    })
  )
    return invalid()
  return snapshot
}

export function createWorkspaceClient(
  endpoint: string | undefined,
  fixture = false,
): WorkspaceClient {
  let destination: string | null = null
  let configurationError: WorkspaceClient['configurationError']
  if (!endpoint)
    configurationError = {
      code: 'missing-endpoint',
      message:
        'No workspace connection is configured. Set a workspace URL and reload the client.',
    }
  else {
    try {
      const url = new URL(endpoint, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol)) {
        configurationError = {
          code: 'unsupported-scheme',
          message:
            'The workspace URL must use HTTP or HTTPS. Update the configured URL and reload the client.',
        }
      } else destination = url.href
    } catch {
      configurationError = {
        code: 'invalid-endpoint',
        message:
          'The workspace URL is invalid. Check the configured URL and reload the client.',
      }
    }
  }
  return {
    connectionKey: JSON.stringify([
      'workspace-v1',
      destination ?? endpoint ?? null,
      fixture,
    ]),
    configurationError,
    fixture,
    controls:
      fixture && destination ? createControlClient(destination) : undefined,
    media: fixture && destination ? createMediaClient(destination) : undefined,
    work: fixture && destination ? createWorkClient(destination) : undefined,
    conversations:
      fixture && destination
        ? createConversationClient(destination)
        : undefined,
    management:
      fixture && destination ? createFixtureManagement(destination) : undefined,
    async readWorkspace(signal) {
      if (configurationError) throw new Error(configurationError.message)
      if (!destination)
        throw new Error('No workspace connection is configured.')
      const response = await fetch(destination, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok)
        throw new Error(`Workspace unavailable (HTTP ${response.status}).`)
      return parseWorkspace(await response.json())
    },
  }
}
