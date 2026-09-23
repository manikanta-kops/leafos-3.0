import { ArtifactCard } from '../media/ArtifactCard'
import type { Message as MessageModel, PreviewData } from './model'
import { formatSize, formatTime } from './model'
import { Markdown } from './Markdown'
import { Icon } from '../../components/Icon'

export function Avatar({
  name,
  color = 'iris',
  isSelf = false,
}: {
  name: string
  color?: string
  isSelf?: boolean
}) {
  return (
    <span aria-hidden="true" className={`avatar ${isSelf ? 'you' : color}`}>
      {isSelf ? 'Y' : name.charAt(0)}
    </span>
  )
}
export function Message({
  message,
  data,
}: {
  message: MessageModel
  data: PreviewData
}) {
  const thread = data.threadsById[message.threadId]
  const chat = thread && data.chatsById[thread.chatId]
  const author = data.actorsById[message.authorId]
  const isSelf = message.authorId === data.currentHumanId
  const name = isSelf ? 'You' : (author?.name ?? 'Deleted participant')
  return (
    <div className="message-content">
      <Avatar
        name={name}
        color={author?.kind === 'agent' ? author.color : undefined}
        isSelf={isSelf}
      />
      <div className="message-body">
        <div className="message-meta">
          <strong>{name}</strong>
          <time dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
          {message.submissionId && (
            <span className="message-state">Accepted</span>
          )}
          {message.status === 'final' && (message.revision ?? 0) > 1 && (
            <span className="message-state">Final text</span>
          )}
          {message.status === 'draft' && (
            <span className="message-state">Draft response</span>
          )}
        </div>
        {message.parts.map((part, index) => {
          if (part.type === 'text')
            return <Markdown key={index} text={part.text} />
          if (part.type === 'unknown')
            return (
              <p key={index} className="unsupported-part">
                Unsupported content: {part.originalKind}
              </p>
            )
          if (part.type === 'file' && chat)
            return (
              <ArtifactCard
                key={index}
                artifactId={part.artifactId}
                fallback={data.artifactsById[part.artifactId]}
                voice={part.purpose === 'voice_note'}
                target={{
                  installationId: data.installationId,
                  callerId: data.currentHumanId,
                  context: chat.context,
                  chatId: chat.id,
                  threadId: message.threadId,
                }}
              />
            )
          const file =
            part.type === 'local-file'
              ? part.file
              : data.artifactsById[part.artifactId]
          const local =
            part.type === 'local-file' ||
            (file &&
              'availability' in file &&
              file.availability === 'local-preview')
          return (
            <div className="file-row" key={index}>
              <Icon name="file" weight="duotone" />
              <span>
                {file?.name ?? 'Unavailable file'}
                <small>
                  {file
                    ? `${formatSize(file.size)} · ${local ? 'Local attachment metadata · bytes not saved' : 'Registered artifact'}`
                    : 'File metadata unavailable'}
                </small>
              </span>
            </div>
          )
        })}
        {message.preparation?.map((p) => (
          <section
            key={p.id}
            className="preparation-card"
            aria-label="Voice preparation"
            aria-live="polite"
          >
            <strong>
              {p.status === 'preparing'
                ? 'Preparing voice note…'
                : p.status === 'succeeded'
                  ? 'Transcript'
                  : p.status === 'no-speech'
                    ? 'No speech detected'
                    : 'Transcription unavailable'}
            </strong>
            <small>
              Derived from voice note {p.partIndex + 1} ·{' '}
              {p.simulated ? 'Simulated preparation' : 'Preparation'} ·{' '}
              {p.provider}
            </small>
            {p.transcript && <p>{p.transcript}</p>}
            {p.error && (
              <p>{p.error} Original audio and typed inputs remain available.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
