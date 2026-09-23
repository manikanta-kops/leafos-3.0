import { conversationFixture } from './conversation-fixture.js'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPreviewData } from './fixtures.js'
import type { WorkspaceSnapshot } from '../data/workspace-client.js'
import type { CommandResult, WorkspaceCommand } from '../data/management.js'

/** Process-memory HTTP test fixture. Never installed in an ordinary production server. */
export function workspaceFixture(): Plugin {
  const instances = new Map<string, ReturnType<typeof instance>>()
  function instance() {
    const initial = createPreviewData()
    const state: WorkspaceSnapshot = {
      installationId: initial.installationId,
      currentHumanId: initial.currentHumanId,
      actorsById: initial.actorsById,
      organizations: initial.organizations,
      memberships: initial.memberships,
      groups: initial.groups,
      groupAssignments: initial.groupAssignments,
      agentRoles: initial.agentRoles,
    }
    state.actorsById['unassigned-ari'] = {
      id: 'unassigned-ari',
      kind: 'agent',
      name: 'Ari',
      description: 'Independent research partner',
      color: 'mint',
    }
    return {
      state,
      receipts: new Map<string, CommandResult>(),
      conversations: conversationFixture(state, initial),
    }
  }
  async function serve(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = url.pathname.match(
      /^\/__fixtures\/(workspace(?:-[a-zA-Z0-9]+)?|a|b)(.*)$/,
    )
    if (!match) return next()
    const key = match[1]
    const fixture = instances.get(key) ?? instance()
    instances.set(key, fixture)
    if (match[2].startsWith('/conversations/'))
      return fixture.conversations(req, res, match[2].slice(14), url)
    const { state, receipts } = fixture
    const send = (value: unknown, status = 200) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(value))
    }
    const reject = (message: string, code = 'invalid-command') =>
      send(
        { outcome: 'rejected', message, code, requestId: crypto.randomUUID() },
        400,
      )
    const scopeMatches = (scope: {
      installationId?: string | null
      callerId?: string | null
    }) =>
      scope.installationId === state.installationId &&
      scope.callerId === state.currentHumanId
    if (req.method === 'GET' && !match[2]) return send(state)
    if (req.method === 'GET') {
      if (
        !scopeMatches({
          installationId: url.searchParams.get('installationId'),
          callerId: url.searchParams.get('callerId'),
        })
      )
        return reject('The installation or caller changed.', 'context-changed')
      if (match[2] === '/agents')
        return send(
          Object.values(state.actorsById).filter((a) => a.kind === 'agent'),
        )
      if (match[2].startsWith('/commands/'))
        return send(
          receipts.get(decodeURIComponent(match[2].slice(10))) ?? null,
        )
    }
    if (req.method !== 'POST' || match[2] !== '/commands')
      return reject('Unsupported fixture operation.')
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 100_000) return reject('Request is too large.')
      }
      const command = JSON.parse(body) as WorkspaceCommand
      if (!scopeMatches(command))
        return reject('The installation or caller changed.', 'context-changed')
      if (typeof command.commandId !== 'string' || !command.commandId)
        return reject('A command identity is required.')
      const prior = receipts.get(command.commandId)
      if (prior) return send(prior)
      const op = command.operation
      const operationFields: Record<string, string[]> = {
        'organization.create': ['fields'],
        'organization.update': ['organizationId', 'fields'],
        'agent.create': ['fields'],
        'membership.add': ['organizationId', 'agentId'],
        'membership.remove': ['organizationId', 'membershipId'],
        'group.create': ['organizationId', 'name'],
        'group.rename': ['organizationId', 'groupId', 'name'],
        'group.delete': ['organizationId', 'groupId'],
        'group.move': ['organizationId', 'groupId', 'direction'],
        'appearance.add': ['organizationId', 'groupId', 'membershipId'],
        'appearance.remove': ['organizationId', 'groupId', 'membershipId'],
        'appearance.move': [
          'organizationId',
          'groupId',
          'membershipId',
          'direction',
        ],
      }
      if (
        !op ||
        typeof op !== 'object' ||
        !operationFields[op.type] ||
        Object.keys(op).some(
          (key) => key !== 'type' && !operationFields[op.type].includes(key),
        ) ||
        Object.keys(command).some(
          (key) =>
            !['commandId', 'installationId', 'callerId', 'operation'].includes(
              key,
            ),
        )
      )
        throw new Error('Unsupported command fields.')
      if (
        operationFields[op.type].includes('organizationId') &&
        (!('organizationId' in op) ||
          typeof op.organizationId !== 'string' ||
          !op.organizationId)
      )
        throw new Error('An explicit organization target is required.')
      const draft = structuredClone(state)
      const id = () => crypto.randomUUID()
      const name = (value: unknown) => {
        if (typeof value !== 'string' || !value.trim() || value.length > 160)
          throw new Error('Enter a name of 1–160 characters.')
        return value.trim()
      }
      const metadata = (fields: Record<string, unknown>) => {
        if (
          !fields ||
          typeof fields !== 'object' ||
          Object.keys(fields).some(
            (k) => !['name', 'description', 'instructions'].includes(k),
          )
        )
          throw new Error('Unsupported metadata field.')
        for (const [key, value] of Object.entries(fields)) {
          if (typeof value !== 'string' || value.length > 20_000)
            throw new Error(
              'Metadata must be text of at most 20,000 characters.',
            )
          if (key === 'name') fields.name = name(value)
        }
        return fields
      }
      const organizationId =
        'organizationId' in op ? op.organizationId : undefined
      if (
        organizationId &&
        !draft.organizations.some((o) => o.id === organizationId)
      )
        throw new Error('The target organization no longer exists.')
      const group =
        'groupId' in op
          ? draft.groups.find(
              (g) => g.id === op.groupId && g.organizationId === organizationId,
            )
          : undefined
      if ('groupId' in op && !group)
        throw new Error(
          'The target group no longer exists in this organization.',
        )
      const member =
        'membershipId' in op
          ? draft.memberships.find(
              (m) =>
                m.id === op.membershipId && m.organizationId === organizationId,
            )
          : undefined
      if ('membershipId' in op && !member)
        throw new Error(
          'The target membership no longer exists in this organization.',
        )
      function move<T>(
        all: T[],
        selected: T,
        matches: (item: T) => boolean,
        direction: 'up' | 'down',
      ) {
        if (!['up', 'down'].includes(direction))
          throw new Error('Invalid ordering direction.')
        const relevant = all.filter(matches)
        const other =
          relevant[relevant.indexOf(selected) + (direction === 'up' ? -1 : 1)]
        if (other) {
          const a = all.indexOf(selected)
          const b = all.indexOf(other)
          ;[all[a], all[b]] = [all[b], all[a]]
        }
      }
      let resourceId: string | undefined
      switch (op.type) {
        case 'organization.create': {
          const fields = metadata(op.fields)
          resourceId = id()
          draft.organizations.push({
            ...fields,
            id: resourceId,
            name: name(fields.name),
          })
          break
        }
        case 'organization.update':
          Object.assign(
            draft.organizations.find((o) => o.id === op.organizationId)!,
            metadata(op.fields),
          )
          break
        case 'agent.create': {
          const fields = metadata(op.fields)
          resourceId = id()
          draft.actorsById[resourceId] = {
            ...fields,
            id: resourceId,
            kind: 'agent',
            name: name(fields.name),
            description: String(fields.description ?? ''),
            color: 'iris',
          }
          break
        }
        case 'membership.add': {
          if (draft.actorsById[op.agentId]?.kind !== 'agent')
            throw new Error('Choose an existing global agent.')
          const existing = draft.memberships.find(
            (m) =>
              m.organizationId === op.organizationId &&
              m.actorId === op.agentId,
          )
          resourceId = existing?.id ?? id()
          if (!existing)
            draft.memberships.push({
              id: resourceId,
              organizationId: op.organizationId,
              actorId: op.agentId,
            })
          break
        }
        case 'membership.remove':
          draft.memberships = draft.memberships.filter((m) => m !== member)
          draft.groupAssignments = draft.groupAssignments.filter(
            (a) => a.membershipId !== op.membershipId,
          )
          break
        case 'group.create':
          resourceId = id()
          draft.groups.push({
            id: resourceId,
            organizationId: op.organizationId,
            name: name(op.name),
          })
          break
        case 'group.rename':
          group!.name = name(op.name)
          break
        case 'group.delete':
          draft.groups = draft.groups.filter((g) => g !== group)
          draft.groupAssignments = draft.groupAssignments.filter(
            (a) => a.groupId !== op.groupId,
          )
          break
        case 'group.move':
          move(
            draft.groups,
            group!,
            (g) => g.organizationId === op.organizationId,
            op.direction,
          )
          break
        case 'appearance.add':
          if (
            !draft.groupAssignments.some(
              (a) =>
                a.groupId === op.groupId && a.membershipId === op.membershipId,
            )
          )
            draft.groupAssignments.push({
              groupId: op.groupId,
              membershipId: op.membershipId,
            })
          break
        case 'appearance.remove':
          draft.groupAssignments = draft.groupAssignments.filter(
            (a) =>
              a.groupId !== op.groupId || a.membershipId !== op.membershipId,
          )
          break
        case 'appearance.move': {
          const assignment = draft.groupAssignments.find(
            (a) =>
              a.groupId === op.groupId && a.membershipId === op.membershipId,
          )
          if (!assignment) throw new Error('This appearance no longer exists.')
          move(
            draft.groupAssignments,
            assignment,
            (a) => a.groupId === op.groupId,
            op.direction,
          )
          break
        }
        default:
          throw new Error('Unsupported management operation.')
      }
      Object.assign(state, draft)
      const result: CommandResult = {
        status: 'acknowledged',
        commandId: command.commandId,
        installationId: state.installationId,
        callerId: state.currentHumanId,
        workspace: structuredClone(state),
        resourceId,
      }
      receipts.set(command.commandId, result)
      return send(result)
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid command.')
    }
  }
  return {
    name: 'development-workspace-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void serve(req, res, next)
      })
    },
    configurePreviewServer(server) {
      if (process.env.LEAFOS_FIXTURE === '1')
        server.middlewares.use((req, res, next) => {
          void serve(req, res, next)
        })
    },
  }
}
