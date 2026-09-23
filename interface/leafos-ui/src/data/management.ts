import type { Agent } from '../features/chat/model.js'
import type { WorkspaceSnapshot } from './workspace-client.js'

/** Provisional UI seam, not a Core protocol or a durability guarantee. */
export type Metadata = {
  name: string
  description: string
  instructions: string
}
export type WorkspaceOperation =
  | { type: 'organization.create'; fields: Metadata }
  | {
      type: 'organization.update'
      organizationId: string
      fields: Partial<Metadata>
    }
  | { type: 'agent.create'; fields: Metadata }
  | { type: 'membership.add'; organizationId: string; agentId: string }
  | { type: 'membership.remove'; organizationId: string; membershipId: string }
  | { type: 'group.create'; organizationId: string; name: string }
  | {
      type: 'group.rename'
      organizationId: string
      groupId: string
      name: string
    }
  | { type: 'group.delete'; organizationId: string; groupId: string }
  | {
      type: 'group.move'
      organizationId: string
      groupId: string
      direction: 'up' | 'down'
    }
  | {
      type: 'appearance.add' | 'appearance.remove'
      organizationId: string
      groupId: string
      membershipId: string
    }
  | {
      type: 'appearance.move'
      organizationId: string
      groupId: string
      membershipId: string
      direction: 'up' | 'down'
    }
export interface CommandScope {
  installationId: string
  callerId: string
}
export interface WorkspaceCommand extends CommandScope {
  commandId: string
  operation: WorkspaceOperation
}
export interface CommandResult extends CommandScope {
  commandId: string
  status: 'acknowledged'
  workspace: WorkspaceSnapshot
  resourceId?: string
}
export interface WorkspaceManagement {
  listAgents(scope: CommandScope, signal: AbortSignal): Promise<Agent[]>
  execute(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<CommandResult>
  readCommand(
    commandId: string,
    scope: CommandScope,
    signal: AbortSignal,
  ): Promise<CommandResult | null>
}
export class CommandError extends Error {
  readonly outcome: 'rejected' | 'unknown'
  readonly code: string
  readonly requestId?: string
  constructor(
    message: string,
    outcome: 'rejected' | 'unknown',
    code: string,
    requestId?: string,
  ) {
    super(message)
    this.outcome = outcome
    this.code = code
    this.requestId = requestId
  }
}
