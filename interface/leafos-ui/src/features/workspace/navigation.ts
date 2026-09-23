import { createStore } from 'zustand/vanilla'
import type { WorkspaceSnapshot } from '../../data/workspace-client'

export interface Navigation {
  organizationId: string | null
  agentId: string | null
  target: 'organization' | 'installation'
  collapsed: boolean
  closedGroups: string[]
}
export const defaultNavigation: Navigation = {
  organizationId: null,
  agentId: null,
  target: 'organization',
  collapsed: false,
  closedGroups: [],
}
export function parseNavigation(value: unknown): Navigation {
  if (!value || typeof value !== 'object') return { ...defaultNavigation }
  const v = value as Partial<Navigation>
  return {
    organizationId:
      typeof v.organizationId === 'string' ? v.organizationId : null,
    agentId: typeof v.agentId === 'string' ? v.agentId : null,
    target: v.target === 'installation' ? 'installation' : 'organization',
    collapsed: v.collapsed === true,
    closedGroups: Array.isArray(v.closedGroups)
      ? v.closedGroups.filter((id): id is string => typeof id === 'string')
      : [],
  }
}
export function resolveNavigation(
  data: WorkspaceSnapshot,
  nav: Navigation,
): Navigation {
  const organizationId = data.organizations.some(
    (o) => o.id === nav.organizationId,
  )
    ? nav.organizationId
    : (data.organizations[0]?.id ?? null)
  const root =
    nav.target === 'installation' &&
    data.agentRoles.some((r) => r.agentId === nav.agentId)
  const members = data.memberships.filter(
    (m) =>
      m.organizationId === organizationId &&
      data.actorsById[m.actorId]?.kind === 'agent',
  )
  const agentId = root
    ? nav.agentId
    : (members.find((m) => m.actorId === nav.agentId)?.actorId ??
      members[0]?.actorId ??
      null)
  return {
    ...nav,
    organizationId,
    agentId,
    target: root ? 'installation' : 'organization',
    closedGroups: nav.closedGroups.filter((id) =>
      data.groups.some((g) => g.id === id),
    ),
  }
}
export const createNavigationStore = (initial: Navigation) =>
  createStore<Navigation>(() => initial)
