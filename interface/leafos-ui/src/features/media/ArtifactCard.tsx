import { useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClientContext } from '../../data/workspace-hooks'
import type { Artifact } from '../chat/model'
import { formatSize } from '../chat/model'
import type { ConversationTarget } from '../../data/conversations'
import { targetIdentity } from '../../data/media'
import { BlobPreview } from './BlobPreview'
import { previewKind } from './preview-kind'
import { Icon } from '../../components/Icon'
export function ArtifactCard({
  artifactId,
  fallback,
  target,
  voice = false,
}: {
  artifactId: string
  fallback?: Artifact
  target: ConversationTarget
  voice?: boolean
}) {
  const workspace = useContext(ClientContext)
  const client = workspace?.media
  const [download, setDownload] = useState(false)
  const [url, setUrl] = useState('')
  const metadata = useQuery({
    queryKey: [
      'artifact',
      workspace?.connectionKey,
      targetIdentity(target),
      artifactId,
      fallback?.revision,
    ],
    queryFn: ({ signal }) => client!.metadata(artifactId, target, signal),
    enabled: !!client && fallback?.availability !== 'local-preview',
    retry: false,
  })
  const artifact = metadata.data ?? fallback
  const content = useQuery({
    queryKey: [
      'artifact-content',
      workspace?.connectionKey,
      targetIdentity(target),
      artifactId,
      artifact?.revision,
    ],
    queryFn: ({ signal }) => client!.content(artifact!, target, signal),
    enabled:
      !!client &&
      !!metadata.data &&
      artifact?.availability === 'registered' &&
      (!!previewKind(artifact.mimeType) || download),
    retry: false,
    gcTime: 0,
  })
  useEffect(() => {
    if (!content.data) return
    const next = URL.createObjectURL(content.data)
    // Object URLs must be revoked with their owning card.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [content.data])
  const unavailable =
    artifact?.availability !== 'registered' || metadata.isError
  return (
    <section
      className="artifact-card"
      aria-label={`${voice ? 'Voice note' : 'File'}: ${artifact?.name ?? artifactId}`}
    >
      <div className="artifact-heading">
        <Icon name={voice ? 'microphone' : 'file'} weight="duotone" />
        <span>
          <strong>{artifact?.name ?? 'Unavailable file'}</strong>
          <small>
            {artifact
              ? `${formatSize(artifact.size)} · ${artifact.mimeType ?? 'Unknown format'}`
              : 'Metadata unavailable'}
            {voice ? ' · Voice note' : ''}
          </small>
        </span>
        {!unavailable &&
          (url ? (
            <a
              className="icon-button"
              href={url}
              download={artifact?.name}
              aria-label={`Download ${artifact?.name}`}
            >
              <Icon name="download" />
            </a>
          ) : (
            <button
              type="button"
              className="icon-button"
              aria-label={`Prepare download ${artifact?.name}`}
              onClick={() => setDownload(true)}
            >
              <Icon name="download" />
            </button>
          ))}
      </div>
      {metadata.isFetching && <output>Loading file metadata…</output>}
      {unavailable ? (
        <small>
          {artifact?.availability === 'local-preview'
            ? 'Demo metadata only · original bytes unavailable'
            : `File ${artifact?.availability === 'registered' ? 'metadata unavailable' : (artifact?.availability ?? 'unavailable')}`}
        </small>
      ) : content.data ? (
        <BlobPreview blob={content.data} name={artifact?.name ?? 'File'} />
      ) : content.isFetching ? (
        <output>Loading and verifying file bytes…</output>
      ) : (
        <small>
          Preview unavailable for this format. Download the original file.
        </small>
      )}
      {(metadata.isError || content.isError) && (
        <div role="alert">
          <small>{content.error?.message ?? metadata.error?.message}</small>
          <button
            type="button"
            onClick={() => {
              void metadata.refetch()
              if (content.isError) void content.refetch()
            }}
          >
            Retry file
          </button>
        </div>
      )}
      {artifact?.ownership && (
        <small className="artifact-provenance">
          {artifact.ownership.kind === 'fixture-unassigned'
            ? 'Fixture upload · ownership unassigned'
            : `${artifact.ownership.kind === 'agent' ? 'Agent' : 'Organization'} owned · ${artifact.ownership.id}`}{' '}
          {artifact.provenance?.kind === 'published' ? '· Published copy' : ''}
        </small>
      )}
    </section>
  )
}
