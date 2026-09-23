import type {
  SettingsRecord,
  EffectiveSettings,
  InboxNotification,
} from './settings.js'
import type { WorkRecords } from './work.js'
import type {
  Chat,
  ChatContext,
  Thread,
  Message,
  Artifact,
  ContentPart,
} from '../features/chat/model.js'

/** Provisional UI contract; replace via injection when a Core transport exists. */
export interface CallerScope {
  installationId: string
  callerId: string
}
export interface ConversationTarget extends CallerScope {
  context: ChatContext
  chatId: string
  threadId?: string
}
export interface Submission {
  submissionId: string
  target: ConversationTarget
  parts: ContentPart[]
}
export interface Records {
  settings?: SettingsRecord[]
  effective?: EffectiveSettings[]
  notifications?: InboxNotification[]
  attention?: string[]
  work?: WorkRecords
  chats: Chat[]
  threads: Thread[]
  messages: Message[]
  artifacts: Artifact[]
}
export interface HistoryPage extends Records {
  next: string | null
}
export interface Snapshot extends Records {
  sequence: number
  cursor: string
  domain: string
}
export interface ConversationEvent extends Records {
  sequence: number
  cursor: string
  domain: string
  eventId: string
}
export type Receipt =
  | {
      status: 'accepted'
      submissionId: string
      target: ConversationTarget
      threadId: string
      messageId: string
      records: Records
      alreadyAccepted?: boolean
    }
  | { status: 'rejected'; submissionId: string; code: string; message: string }
  | { status: 'unknown'; submissionId: string }
export interface ConversationClient {
  resolve(
    scope: CallerScope,
    agentId: string,
    context: ChatContext,
    signal: AbortSignal,
  ): Promise<Chat>
  history(
    target: ConversationTarget,
    before: string | null,
    signal: AbortSignal,
  ): Promise<HistoryPage>
  submit(submission: Submission, signal: AbortSignal): Promise<Receipt>
  receipt(
    scope: CallerScope,
    submissionId: string,
    signal: AbortSignal,
  ): Promise<Receipt>
  snapshot(
    scope: CallerScope,
    threadId: string | null,
    signal: AbortSignal,
  ): Promise<Snapshot>
  events(
    scope: CallerScope,
    threadId: string | null,
    cursor: string,
    signal: AbortSignal,
    apply: (event: ConversationEvent) => void,
  ): Promise<void>
}
export class ConversationError extends Error {
  readonly code: string
  constructor(message: string, code = 'unavailable') {
    super(message)
    this.code = code
  }
}
export const emptyRecords = (): Records => ({
  chats: [],
  threads: [],
  messages: [],
  artifacts: [],
})
