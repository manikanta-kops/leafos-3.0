import type { ConversationTarget } from './conversations.js'
import type { Artifact } from '../features/chat/model.js'
export type MediaPurpose = 'attachment' | 'voice_note'
export interface UploadIntent {
  uploadId: string
  target: ConversationTarget
  name: string
  mimeType: string
  size: number
  sha256: string
  purpose: MediaPurpose
}
export type UploadReceipt =
  | { status: 'unknown'; uploadId: string }
  | { status: 'accepted'; intent: UploadIntent; artifact: Artifact }
export interface MediaClient {
  capabilities(signal: AbortSignal): Promise<{ maxUploadBytes: number }>
  upload(
    intent: UploadIntent,
    bytes: Blob,
    signal: AbortSignal,
    progress: (fraction: number) => void,
  ): Promise<UploadReceipt>
  receipt(intent: UploadIntent, signal: AbortSignal): Promise<UploadReceipt>
  metadata(
    id: string,
    target: ConversationTarget,
    signal: AbortSignal,
  ): Promise<Artifact>
  content(
    artifact: Artifact,
    target: ConversationTarget,
    signal: AbortSignal,
  ): Promise<Blob>
}
export const targetIdentity = (t: ConversationTarget) =>
  JSON.stringify([
    t.installationId,
    t.callerId,
    t.context.kind,
    t.context.kind === 'organization'
      ? t.context.organizationId
      : t.context.installationId,
    t.chatId,
    t.threadId ?? null,
  ])
export const intentIdentity = (i: UploadIntent) =>
  JSON.stringify([
    i.uploadId,
    targetIdentity(i.target),
    i.name,
    i.mimeType,
    i.size,
    i.sha256,
    i.purpose,
  ])
export async function digest(bytes: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
export function parseArtifact(value: unknown): Artifact {
  const a = value as Artifact
  if (
    !a ||
    typeof a.id !== 'string' ||
    typeof a.name !== 'string' ||
    !Number.isSafeInteger(a.size) ||
    a.size < 0 ||
    !['registered', 'missing', 'deleted', 'failed', 'local-preview'].includes(
      a.availability,
    )
  )
    throw new Error('Invalid artifact metadata.')
  if (
    a.availability === 'registered' &&
    (typeof a.mimeType !== 'string' ||
      !/^[a-f0-9]{64}$/.test(a.sha256 ?? '') ||
      !Number.isSafeInteger(a.revision))
  )
    throw new Error('Invalid artifact content metadata.')
  if (
    a.ownership &&
    (!['fixture-unassigned', 'agent', 'organization'].includes(
      a.ownership.kind,
    ) ||
      (a.ownership.id !== undefined && typeof a.ownership.id !== 'string'))
  )
    throw new Error('Invalid artifact ownership metadata.')
  if (
    a.provenance &&
    (!['upload', 'generated', 'published'].includes(a.provenance.kind) ||
      typeof a.provenance.authorId !== 'string')
  )
    throw new Error('Invalid artifact provenance.')
  return a
}
export function createMediaClient(endpoint: string): MediaClient {
  const base = `${endpoint}/conversations/media`
  const query = (target: ConversationTarget) =>
    new URLSearchParams({ target: JSON.stringify(target) })
  async function json(path: string, signal: AbortSignal) {
    const response = await fetch(base + path, { signal, cache: 'no-store' })
    if (!response.ok)
      throw new Error(`Media service unavailable (HTTP ${response.status}).`)
    return response.json()
  }
  function receipt(value: UploadReceipt, intent: UploadIntent): UploadReceipt {
    if (value.status === 'unknown' && value.uploadId === intent.uploadId)
      return value
    if (
      value.status !== 'accepted' ||
      intentIdentity(value.intent) !== intentIdentity(intent)
    )
      throw new Error(
        'Upload receipt does not match the original bytes and destination.',
      )
    const artifact = parseArtifact(value.artifact)
    if (
      artifact.sha256 !== intent.sha256 ||
      artifact.size !== intent.size ||
      artifact.name !== intent.name ||
      artifact.mimeType !== intent.mimeType
    )
      throw new Error('Upload artifact does not match the selected file.')
    return { ...value, artifact }
  }
  return {
    async capabilities(signal) {
      const result = await json('/capabilities', signal)
      if (
        !Number.isSafeInteger(result.maxUploadBytes) ||
        result.maxUploadBytes <= 0
      )
        throw new Error('Invalid media capabilities.')
      return result
    },
    upload(intent, bytes, signal, progress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const abort = () => xhr.abort()
        xhr.open(
          'PUT',
          `${base}/uploads/${encodeURIComponent(intent.uploadId)}?intent=${encodeURIComponent(JSON.stringify(intent))}`,
        )
        xhr.timeout = 30000
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) progress(event.loaded / event.total)
        }
        xhr.onload = () => {
          try {
            if (xhr.status !== 200)
              throw new Error(
                `Upload acknowledgement unavailable (HTTP ${xhr.status}).`,
              )
            resolve(receipt(JSON.parse(xhr.responseText), intent))
          } catch (error) {
            reject(error)
          }
        }
        xhr.onerror = xhr.ontimeout = () =>
          reject(
            new Error(
              'Upload acknowledgement unavailable. Check receipt or retry the same upload.',
            ),
          )
        xhr.onabort = () =>
          reject(
            new DOMException(
              'Upload cancelled locally; remote outcome may be unknown.',
              'AbortError',
            ),
          )
        xhr.onloadend = () => signal.removeEventListener('abort', abort)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) {
          reject(new DOMException('Cancelled', 'AbortError'))
          return
        }
        xhr.send(bytes)
      })
    },
    async receipt(intent, signal) {
      return receipt(
        await json(
          `/uploads/${encodeURIComponent(intent.uploadId)}?${query(intent.target)}`,
          signal,
        ),
        intent,
      )
    },
    async metadata(id, target, signal) {
      const a = parseArtifact(
        await json(
          `/artifacts/${encodeURIComponent(id)}?${query(target)}`,
          signal,
        ),
      )
      if (a.id !== id) throw new Error('Artifact identity mismatch.')
      return a
    },
    async content(artifact, target, signal) {
      const response = await fetch(
        `${base}/artifacts/${encodeURIComponent(artifact.id)}/content?${query(target)}`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok)
        throw new Error('File content is missing or unavailable.')
      const bytes = await response.blob()
      if (
        bytes.size !== artifact.size ||
        (await digest(bytes)) !== artifact.sha256
      )
        throw new Error('File integrity verification failed.')
      return new Blob([bytes], { type: artifact.mimeType })
    },
  }
}
