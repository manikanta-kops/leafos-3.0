import type { UploadIntent, UploadReceipt } from './media'
import Dexie, { type Table } from 'dexie'
import type { Submission, Receipt } from './conversations'
export interface Draft {
  key: string
  revision: string
  text: string
  uploadIds?: string[]
}
export interface PendingSubmission {
  id: string
  scope: string
  revision: string
  submission: Submission
  state:
    'unsent' | 'sending' | 'uncertain' | 'accepted' | 'rejected' | 'discarded'
  receipt?: Receipt
  updatedAt: number
}
export interface PendingMedia {
  id: string
  draftKey: string
  intent: UploadIntent
  bytes: Blob
  revision: string
  state: 'saved' | 'uploading' | 'uncertain' | 'ready'
  association: 'draft' | 'removed' | 'submitted'
  receipt?: Extract<UploadReceipt, { status: 'accepted' }>
  error?: string
  createdAt: number
  updatedAt: number
}
const db = new Dexie('leafos-conversations') as Dexie & {
  media: Table<PendingMedia, string>
  drafts: Table<Draft, string>
  outbox: Table<PendingSubmission, string>
}
db.version(1).stores({ drafts: '&key', outbox: '&id,scope' })
db.version(2).stores({
  drafts: '&key',
  outbox: '&id,scope',
  media: '&id,draftKey',
})
const revision = () => crypto.randomUUID()
export const conversationStorage = {
  readDraft: async (key: string): Promise<Draft | undefined> =>
    db.drafts.get(key),
  async writeDraft(key: string, expected: string | null, text: string) {
    return db.transaction('rw', db.drafts, async () => {
      const current = await db.drafts.get(key)
      if ((current?.revision ?? null) !== expected)
        return { applied: false, current }
      const next = { key, text, revision: revision() }
      await db.drafts.put(next)
      return { applied: true, current: next }
    })
  },
  list: async (scope: string): Promise<PendingSubmission[]> =>
    db.outbox.where('scope').equals(scope).toArray(),
  async reserve(
    scope: string,
    submission: Submission,
    draft: Draft | undefined,
  ) {
    return db.transaction('rw', db.drafts, db.outbox, db.media, async () => {
      for (const id of draft?.uploadIds ?? []) {
        const media = await db.media.get(id)
        if (
          !media ||
          media.draftKey !== draft?.key ||
          media.association !== 'draft' ||
          media.state !== 'ready'
        )
          throw new Error(
            'Attachment changed in another tab. Review the saved draft before sending.',
          )
        await db.media.put({
          ...media,
          association: 'submitted',
          revision: revision(),
        })
      }
      const value: PendingSubmission = {
        id: submission.submissionId,
        scope,
        submission: structuredClone(submission),
        state: 'unsent',
        revision: revision(),
        updatedAt: Date.now(),
      }
      await db.outbox.add(value)
      let cleared: Draft | undefined
      if (draft) {
        const current = await db.drafts.get(draft.key)
        if (current?.revision === draft.revision) {
          cleared = { key: draft.key, text: '', revision: revision() }
          await db.drafts.put(cleared)
        }
      }
      return { value, cleared }
    })
  },
  async transition(
    expected: PendingSubmission,
    state: PendingSubmission['state'],
    receipt?: Receipt,
  ) {
    return db.transaction('rw', db.outbox, async () => {
      const current = await db.outbox.get(expected.id)
      if (
        !current ||
        current.revision !== expected.revision ||
        current.state !== expected.state
      )
        return { applied: false, current }
      const next = {
        ...current,
        state,
        receipt: receipt ?? current.receipt,
        revision: revision(),
        updatedAt: Date.now(),
      }
      await db.outbox.put(next)
      return { applied: true, current: next }
    })
  },
}

export const mediaStorage = {
  list: (draftKey: string) =>
    db.media.where('draftKey').equals(draftKey).sortBy('createdAt'),
  get: (id: string) => db.media.get(id),
  add: async (item: PendingMedia): Promise<string> => db.media.add(item),
  async change(
    expected: PendingMedia,
    change: Partial<
      Pick<PendingMedia, 'state' | 'receipt' | 'association' | 'error'>
    >,
  ) {
    return db.transaction('rw', db.media, async () => {
      const current = await db.media.get(expected.id)
      if (!current || current.revision !== expected.revision) return undefined
      const next = {
        ...current,
        ...change,
        revision: revision(),
        updatedAt: Date.now(),
      }
      await db.media.put(next)
      return next
    })
  },
}
