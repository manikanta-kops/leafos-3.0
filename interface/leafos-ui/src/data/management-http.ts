import { parseWorkspace } from './workspace-client.js'
import {
  CommandError,
  type CommandResult,
  type WorkspaceManagement,
} from './management.js'
import type { Agent } from '../features/chat/model.js'

/** Only wired to the explicitly enabled development fixture. Core routes are not defined here. */
export function createFixtureManagement(endpoint: string): WorkspaceManagement {
  async function request(path: string, signal: AbortSignal, body?: unknown) {
    try {
      const response = await fetch(endpoint + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) {
        if (
          data.outcome === 'rejected' &&
          typeof data.message === 'string' &&
          typeof data.code === 'string'
        )
          throw new CommandError(
            data.message,
            'rejected',
            data.code,
            data.requestId,
          )
        throw new Error('The server did not confirm the outcome.')
      }
      return data
    } catch (error) {
      if (error instanceof CommandError) throw error
      throw new CommandError(
        'The outcome is unknown. Check the original request before starting another action.',
        'unknown',
        'transport',
      )
    }
  }
  function result(value: unknown): CommandResult {
    const v = value as CommandResult
    if (
      !v ||
      v.status !== 'acknowledged' ||
      typeof v.commandId !== 'string' ||
      typeof v.callerId !== 'string' ||
      typeof v.installationId !== 'string' ||
      (v.resourceId !== undefined && typeof v.resourceId !== 'string')
    )
      throw new CommandError(
        'The acknowledgement is incompatible. Check the original request.',
        'unknown',
        'invalid-result',
      )
    return { ...v, workspace: parseWorkspace(v.workspace) }
  }
  return {
    async listAgents(scope, signal) {
      const data = await request(
        '/agents?' + new URLSearchParams({ ...scope }),
        signal,
      )
      if (
        !Array.isArray(data) ||
        !data.every(
          (a: Agent) =>
            a.kind === 'agent' &&
            typeof a.id === 'string' &&
            typeof a.name === 'string' &&
            typeof a.description === 'string' &&
            typeof a.color === 'string',
        ) ||
        new Set(data.map((a: Agent) => a.id)).size !== data.length
      )
        throw new Error('The global agent catalog is incompatible.')
      return data as Agent[]
    },
    async execute(command, signal) {
      return result(await request('/commands', signal, command))
    },
    async readCommand(commandId, scope, signal) {
      const value = await request(
        '/commands/' +
          encodeURIComponent(commandId) +
          '?' +
          new URLSearchParams({ ...scope }),
        signal,
      )
      return value === null ? null : result(value)
    },
  }
}
