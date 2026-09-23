import type { EffectiveSettings } from './settings.js'
import type { ConversationTarget, Records } from './conversations.js'

/** Replaceable UI projection, pending the Core work runtime. */
export type WorkState =
  | 'preparing'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'held'
  | 'cancellation-requested'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'recovery-needed'
export type WorkAction =
  'stop' | 'resume' | 'retry' | 'cancel-queued' | 'steer' | 'respond'
export interface WorkTarget extends ConversationTarget {
  threadId: string
}
export interface WorkResource {
  id: string
  revision: number
  target: WorkTarget
}
export interface AvailableAction {
  action: WorkAction
  allowed: boolean
  reason: string
}
export interface Workflow extends WorkResource {
  runId: string
  attemptId: string
  state: WorkState
  holdGeneration?: number
  retryContinuation?: {
    operationId: string
    attemptId: string
    holdGeneration: number
  }
  held: boolean
  reason: string
  actions: AvailableAction[]
}
export interface Run extends WorkResource {
  originMessageId: string
  currentAttemptId: string
  state: WorkState
}
export interface Attempt extends WorkResource {
  suppliedSettings?: EffectiveSettings & { simulated: true }
  runId: string
  state: WorkState
  number: number
  startedAt: string
}
export interface QueueEntry extends WorkResource {
  readiness?: 'preparing' | 'ready'
  messageId: string
  text: string
  acceptanceOrder: number
  state: 'queued' | 'held' | 'consumed' | 'cancelled'
  actions: AvailableAction[]
}
export interface PublicActivity extends WorkResource {
  runId: string
  attemptId: string
  order: number
  createdAt: string
  actorId: string
  text: string
  state: WorkState
}
export interface Delegation extends WorkResource {
  runId: string
  attemptId: string
  fromAgentId: string
  toAgentId: string
  childRunId: string
  request?: { originMessageId: string; summary: string }
  result?: { id: string; summary: string; receivedAt: string; late: boolean }
  originInteractionId?: string
  state: WorkState
  createdAt: string
}
export type Answer =
  | { kind: 'choice'; optionId: string; text?: string }
  | { kind: 'text'; text: string }
  | { kind: 'dismiss' }
  | { kind: 'approve' | 'decline'; comment?: string }
export interface InteractionResponse {
  operationId: string
  actorId: string
  answer: Answer
  acceptedAt: string
}
export interface Interaction extends WorkResource {
  version: 1
  kind: 'question' | 'approval'
  runId: string
  attemptId: string
  sourceAgentId: string
  delegationId?: string
  proposalId?: string
  prompt: string
  options: { id: string; label: string }[]
  freeText: boolean
  state: 'pending' | 'settled' | 'cancelled' | 'superseded'
  response?: InteractionResponse
  continuation: 'waiting' | 'ready' | 'recovery-needed' | 'cancelled'
  reason: string
}
export interface WorkRecords {
  workflows: Workflow[]
  runs: Run[]
  attempts: Attempt[]
  queue: QueueEntry[]
  activity: PublicActivity[]
  delegations: Delegation[]
  interactions: Interaction[]
}
export const emptyWork = (): WorkRecords => ({
  workflows: [],
  runs: [],
  attempts: [],
  queue: [],
  activity: [],
  delegations: [],
  interactions: [],
})
export interface WorkOperation {
  operationId: string
  target: WorkTarget
  action: WorkAction
  runId: string
  attemptId: string
  queueId?: string
  interactionId?: string
  interactionVersion?: number
  proposalId?: string
  answer?: Answer
}
export type WorkReceipt =
  | { operationId: string; status: 'unknown' }
  | {
      operationId: string
      status: 'accepted' | 'rejected'
      target: WorkTarget
      message: string
      records: Records
      response?: InteractionResponse
    }
export interface WorkClient {
  command(operation: WorkOperation, signal: AbortSignal): Promise<WorkReceipt>
  receipt(operation: WorkOperation, signal: AbortSignal): Promise<WorkReceipt>
}
export const workLabels: Record<WorkState, string> = {
  preparing: 'Preparing',
  queued: 'Queued',
  running: 'Working',
  waiting: 'Waiting for input',
  held: 'Follow-ups held',
  'cancellation-requested': 'Cancellation requested',
  cancelled: 'Stopped',
  completed: 'Completed',
  failed: 'Failed',
  'recovery-needed': 'Recovery needed',
}
