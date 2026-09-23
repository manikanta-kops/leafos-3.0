import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { Icon } from '../../components/Icon'
import { useWorkspace } from '../../data/workspace-hooks'
import { useManagement } from '../../data/use-management'
import type { Metadata, WorkspaceOperation } from '../../data/management'
import type { WorkspaceSnapshot } from '../../data/workspace-client'

export function Management({
  data,
  organizationId,
}: {
  data: WorkspaceSnapshot
  organizationId: string | null
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const management = useManagement(data)
  const [target, setTarget] = useState<{
    organizationId: string | null
  } | null>(null)
  return (
    <>
      <button
        ref={trigger}
        className="management-trigger"
        onClick={() => setTarget({ organizationId })}
        aria-label="Manage workspace"
        title="Manage workspace"
      >
        <Icon name="plus" />
        <span className="sidebar-label">Manage workspace</span>
        {management.pending && (
          <span className="recovery-dot" aria-label="Request needs attention" />
        )}
      </button>
      {target && (
        <ManagementDialog
          data={data}
          organizationId={target.organizationId}
          management={management}
          onClose={() => {
            setTarget(null)
            requestAnimationFrame(() => trigger.current?.focus())
          }}
        />
      )}
    </>
  )
}

type Manager = ReturnType<typeof useManagement>
type FormKind =
  | 'organization-create'
  | 'organization-edit'
  | 'agent-create'
  | 'group-create'
  | null
function ManagementDialog({
  data,
  organizationId,
  management: m,
  onClose,
}: {
  data: WorkspaceSnapshot
  organizationId: string | null
  management: Manager
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const reduced = useReducedMotion()
  const { client } = useWorkspace()
  const [tab, setTab] = useState('organization')
  const [form, setForm] = useState<FormKind>(null)
  const [fields, setFields] = useState<Metadata>({
    name: '',
    description: '',
    instructions: '',
  })
  const [original, setOriginal] = useState<Metadata>(fields)
  const [addMembership, setAddMembership] = useState(!!organizationId)
  const [confirmation, setConfirmation] = useState<{
    operation: WorkspaceOperation
    title: string
    text: string
  } | null>(null)
  const [rename, setRename] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [search, setSearch] = useState('')
  const organization = data.organizations.find((o) => o.id === organizationId)
  const members = data.memberships.filter(
    (member) =>
      member.organizationId === organizationId &&
      data.actorsById[member.actorId]?.kind === 'agent',
  )
  const groups = data.groups.filter((g) => g.organizationId === organizationId)
  const blocked = !m.ready || m.busy || !!m.pending || !m.available
  const catalog = useQuery({
    queryKey: [
      'agent-catalog',
      client.connectionKey,
      data.installationId,
      data.currentHumanId,
    ],
    queryFn: ({ signal }) =>
      client.management!.listAgents(
        { installationId: data.installationId, callerId: data.currentHumanId },
        signal,
      ),
    enabled: !!client.management && tab === 'agents',
    retry: false,
  })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => {
      previous?.focus()
    }
  }, [])
  function openForm(kind: FormKind) {
    const value =
      kind === 'organization-edit' && organization
        ? {
            name: organization.name,
            description: organization.description ?? '',
            instructions: organization.instructions ?? '',
          }
        : { name: '', description: '', instructions: '' }
    setFields(value)
    setOriginal(value)
    setForm(kind)
  }
  async function saveForm() {
    let operation: WorkspaceOperation
    if (form === 'organization-create')
      operation = { type: 'organization.create', fields }
    else if (form === 'agent-create')
      operation = { type: 'agent.create', fields }
    else if (form === 'group-create' && organizationId)
      operation = { type: 'group.create', organizationId, name: fields.name }
    else if (form === 'organization-edit' && organizationId)
      operation = {
        type: 'organization.update',
        organizationId,
        fields: Object.fromEntries(
          Object.entries(fields).filter(
            ([key, value]) => value !== original[key as keyof Metadata],
          ),
        ),
      }
    else return
    const acknowledged = await m.submit(
      operation,
      form === 'agent-create'
        ? 'Agent'
        : form === 'group-create'
          ? 'Group'
          : 'Organization',
      form === 'agent-create' && addMembership
        ? (organizationId ?? undefined)
        : undefined,
    )
    if (acknowledged) setForm(null)
  }
  const command = (operation: WorkspaceOperation, label: string) => {
    void m.submit(operation, label)
  }
  return (
    <dialog
      ref={dialog}
      className="management-dialog"
      aria-labelledby="management-title"
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
        if (event.key === 'Tab') {
          const controls = Array.from(
            dialog.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ),
          ).filter((el) => el.getClientRects().length)
          const first = controls[0]
          const last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.18 }}
      >
        <header className="management-header">
          <div>
            <p className="management-eyebrow">Workspace</p>
            <h2 id="management-title">
              {organization?.name ?? 'Installation'}
            </h2>
            <small>{organizationId ?? data.installationId}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Close management"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="management-tabs" aria-label="Management sections">
          {['organization', 'agents', 'groups'].map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value)
                setForm(null)
                setConfirmation(null)
                setRename(null)
              }}
            >
              {value === 'organization'
                ? 'Organization'
                : value === 'agents'
                  ? 'Agents'
                  : 'Visual groups'}
            </button>
          ))}
        </div>
        <div className="management-body">
          {!m.available && (
            <output>
              Workspace management is unavailable on this connection. A Core
              management integration has not been configured.
            </output>
          )}
          {m.error && (
            <p role="alert" className="management-alert">
              {m.error}
            </p>
          )}
          {m.notice && (
            <output className="management-notice">
              <Icon name="check" />
              {m.notice}
            </output>
          )}
          {m.pending && (
            <section
              className="management-recovery"
              aria-label="Request recovery"
            >
              <strong>
                {m.busy
                  ? 'Waiting for acknowledgement…'
                  : m.pending.state === 'rejected'
                    ? 'Request rejected'
                    : m.pending.state === 'add-ready'
                      ? 'Finish enrollment'
                      : 'Outcome unresolved'}
              </strong>
              <p>{m.pending.message}</p>
              <small>Request {m.pending.command.commandId}</small>
              {'organizationId' in m.pending.command.operation && (
                <small>
                  Target organization:{' '}
                  {m.pending.command.operation.organizationId}
                </small>
              )}
              {m.pending.createdAgentId && (
                <small>Global agent: {m.pending.createdAgentId}</small>
              )}
              <div className="management-actions">
                {m.pending.state === 'unknown' && (
                  <button
                    className="secondary-button"
                    disabled={m.busy}
                    onClick={() => void m.check()}
                  >
                    Check outcome
                  </button>
                )}
                {m.pending.state === 'add-ready' && (
                  <button
                    className="primary-button"
                    disabled={m.busy}
                    onClick={() => void m.addCreated()}
                  >
                    Add created agent
                  </button>
                )}
                {m.pending.createdAgentId &&
                  ['add-ready', 'rejected'].includes(m.pending.state) && (
                    <button
                      className="secondary-button"
                      disabled={m.busy}
                      onClick={() => void m.keepAgent()}
                    >
                      Keep agent without adding
                    </button>
                  )}
                {m.pending.state === 'rejected' && (
                  <button
                    className="secondary-button"
                    disabled={m.busy}
                    onClick={() => void m.dismissRejected()}
                  >
                    {m.pending.createdAgentId
                      ? 'Keep agent and retry membership'
                      : 'Return to editing'}
                  </button>
                )}
              </div>
            </section>
          )}
          {confirmation ? (
            <section className="management-confirm">
              <h3>{confirmation.title}</h3>
              <p>{confirmation.text}</p>
              <div className="management-actions">
                <button
                  className="secondary-button"
                  onClick={() => setConfirmation(null)}
                >
                  Back
                </button>
                <button
                  className="primary-button"
                  disabled={blocked}
                  onClick={async () => {
                    if (
                      await m.submit(confirmation.operation, confirmation.title)
                    )
                      setConfirmation(null)
                  }}
                >
                  Confirm {confirmation.title.toLowerCase()}
                </button>
              </div>
            </section>
          ) : form ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void saveForm()
              }}
            >
              <h3>
                {form === 'organization-create'
                  ? 'Create organization'
                  : form === 'organization-edit'
                    ? 'Edit organization'
                    : form === 'agent-create'
                      ? 'Create a new global agent'
                      : 'Create visual group'}
              </h3>
              {form === 'agent-create' && (
                <p className="management-help">
                  One identity and one continuous brain across organizations. A
                  name is enough to begin.
                </p>
              )}
              <label>
                Name
                <input
                  autoFocus
                  required
                  maxLength={160}
                  disabled={m.busy || !!m.pending}
                  value={fields.name}
                  onChange={(e) =>
                    setFields({ ...fields, name: e.target.value })
                  }
                />
              </label>
              {form !== 'group-create' && (
                <>
                  <label>
                    Description <span>Optional</span>
                    <textarea
                      rows={2}
                      maxLength={20000}
                      disabled={m.busy || !!m.pending}
                      value={fields.description}
                      onChange={(e) =>
                        setFields({ ...fields, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Instructions <span>Optional</span>
                    <textarea
                      rows={5}
                      maxLength={20000}
                      disabled={m.busy || !!m.pending}
                      value={fields.instructions}
                      onChange={(e) =>
                        setFields({ ...fields, instructions: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {form === 'agent-create' && organization && (
                <label className="management-checkbox">
                  <input
                    type="checkbox"
                    disabled={m.busy || !!m.pending}
                    checked={addMembership}
                    onChange={(e) => setAddMembership(e.target.checked)}
                  />
                  Then add to {organization.name}
                </label>
              )}
              {(form === 'agent-create' || form === 'organization-create') && (
                <p className="management-help">
                  Execution settings are not configured by this action. No
                  provider or model is selected automatically.
                </p>
              )}
              <div className="management-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setForm(null)}
                >
                  Back
                </button>
                <button
                  className="primary-button"
                  disabled={blocked || !fields.name.trim()}
                >
                  {m.busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : tab === 'organization' ? (
            <>
              <div className="management-section-heading">
                <h3>Shared context</h3>
                {organization && (
                  <button
                    className="secondary-button"
                    disabled={blocked}
                    onClick={() => openForm('organization-edit')}
                  >
                    Edit organization
                  </button>
                )}
              </div>
              {organization ? (
                <>
                  <p>
                    {organization.description ||
                      'Add a description to explain what this organization is for.'}
                  </p>
                  <h4>Organization instructions</h4>
                  <p className="instruction-preview">
                    {organization.instructions ||
                      'No organization instructions yet.'}
                  </p>
                  <p className="management-help">
                    Instructions contribute context to future executions. They
                    do not replace an agent’s global identity.
                  </p>
                </>
              ) : (
                <p>
                  No organization selected. Create one to begin organizing your
                  agents.
                </p>
              )}
              <div className="management-divider" />
              <button
                className="secondary-button"
                disabled={blocked}
                onClick={() => openForm('organization-create')}
              >
                <Icon name="organization" />
                Create organization
              </button>
            </>
          ) : tab === 'agents' ? (
            <>
              <div className="management-section-heading">
                <div>
                  <h3>Agents in this organization</h3>
                  <p>Membership connects a global identity.</p>
                </div>
                <button
                  className="secondary-button"
                  disabled={blocked}
                  onClick={() => openForm('agent-create')}
                >
                  <Icon name="plus" />
                  Create new agent
                </button>
              </div>
              {!members.length && (
                <p className="management-help">
                  No agent memberships here yet.
                </p>
              )}
              {members.map((member) => (
                <div className="management-row" key={member.id}>
                  <div>
                    <strong>{data.actorsById[member.actorId].name}</strong>
                    <small>{member.actorId}</small>
                  </div>
                  <button
                    className="text-button"
                    disabled={blocked}
                    onClick={() =>
                      setConfirmation({
                        operation: {
                          type: 'membership.remove',
                          organizationId: organizationId!,
                          membershipId: member.id,
                        },
                        title: 'Remove membership',
                        text: `Remove ${data.actorsById[member.actorId].name} from ${organization?.name}? All appearances here are removed. The global agent, other memberships, existing conversations and contributions remain. Already accepted work may finish; this does not stop or cancel it.`,
                      })
                    }
                  >
                    Remove membership
                  </button>
                </div>
              ))}
              <div className="management-divider" />
              <h3>Add an existing agent</h3>
              <p className="management-help">
                Use the same identity and brain. IDs distinguish agents with the
                same name.
              </p>
              <label>
                Find a global agent
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or stable ID"
                />
              </label>
              {catalog.isPending && m.available && (
                <output>Loading global agents…</output>
              )}
              {catalog.isError && (
                <p role="alert">
                  Global agent discovery is unavailable.{' '}
                  <button onClick={() => void catalog.refetch()}>
                    Try again
                  </button>
                </p>
              )}
              {catalog.data
                ?.filter((a) =>
                  `${a.name} ${a.id}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((agent) => {
                  const enrolled = members.some(
                    (member) => member.actorId === agent.id,
                  )
                  const contexts = data.memberships
                    .filter((member) => member.actorId === agent.id)
                    .map(
                      (member) =>
                        data.organizations.find(
                          (o) => o.id === member.organizationId,
                        )?.name,
                    )
                    .filter(Boolean)
                  return (
                    <div className="management-row" key={agent.id}>
                      <div>
                        <strong>{agent.name}</strong>
                        <small>{agent.id}</small>
                        <p>{agent.description}</p>
                        <small>
                          {contexts.join(' · ') ||
                            'No organization memberships'}
                        </small>
                      </div>
                      <button
                        className="secondary-button"
                        aria-label={`Add ${agent.name} (${agent.id})`}
                        disabled={blocked || enrolled || !organization}
                        onClick={() =>
                          command(
                            {
                              type: 'membership.add',
                              organizationId: organizationId!,
                              agentId: agent.id,
                            },
                            'Membership',
                          )
                        }
                      >
                        {enrolled ? 'Already added' : 'Add existing'}
                      </button>
                    </div>
                  )
                })}
              {catalog.data &&
                !catalog.data.some((a) =>
                  `${a.name} ${a.id}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && <p>No agents match this search.</p>}
            </>
          ) : (
            <>
              <div className="management-section-heading">
                <div>
                  <h3>Visual groups</h3>
                  <p>Organize appearances, without duplicating agents.</p>
                </div>
                <button
                  className="secondary-button"
                  disabled={blocked || !organization}
                  onClick={() => openForm('group-create')}
                >
                  <Icon name="folder" />
                  Create group
                </button>
              </div>
              {!groups.length && (
                <p>No visual groups yet. Members appear ungrouped.</p>
              )}
              {groups.map((group, index) => {
                const appearances = data.groupAssignments.filter(
                  (a) => a.groupId === group.id,
                )
                return (
                  <section
                    className="management-group"
                    aria-label={`Manage ${group.name}`}
                    key={group.id}
                  >
                    <div className="management-section-heading">
                      <h4>
                        <Icon name="folder" />
                        {group.name}
                      </h4>
                      <div className="order-actions">
                        <button
                          aria-label={`Move ${group.name} up`}
                          disabled={blocked || index === 0}
                          onClick={() =>
                            command(
                              {
                                type: 'group.move',
                                organizationId: organizationId!,
                                groupId: group.id,
                                direction: 'up',
                              },
                              'Group order',
                            )
                          }
                        >
                          <Icon name="arrow" size={14} />
                        </button>
                        <button
                          aria-label={`Move ${group.name} down`}
                          disabled={blocked || index === groups.length - 1}
                          onClick={() =>
                            command(
                              {
                                type: 'group.move',
                                organizationId: organizationId!,
                                groupId: group.id,
                                direction: 'down',
                              },
                              'Group order',
                            )
                          }
                        >
                          <Icon
                            name="arrow"
                            size={14}
                            style={{ transform: 'rotate(180deg)' }}
                          />
                        </button>
                        <button
                          disabled={blocked}
                          onClick={() =>
                            setRename({ id: group.id, name: group.name })
                          }
                        >
                          Rename
                        </button>
                        <button
                          disabled={blocked}
                          onClick={() =>
                            setConfirmation({
                              operation: {
                                type: 'group.delete',
                                organizationId: organizationId!,
                                groupId: group.id,
                              },
                              title: 'Delete group',
                              text: `Delete ${group.name}? Only this grouping and its appearances are removed. Agents, memberships and conversations remain. Members with no other appearances become ungrouped.`,
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {rename?.id === group.id && (
                      <form
                        className="rename-form"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          if (
                            await m.submit(
                              {
                                type: 'group.rename',
                                organizationId: organizationId!,
                                groupId: group.id,
                                name: rename.name,
                              },
                              'Group name',
                            )
                          )
                            setRename(null)
                        }}
                      >
                        <label>
                          Group name
                          <input
                            autoFocus
                            required
                            maxLength={160}
                            value={rename.name}
                            onChange={(e) =>
                              setRename({ ...rename, name: e.target.value })
                            }
                          />
                        </label>
                        <button
                          className="secondary-button"
                          disabled={blocked || !rename.name.trim()}
                        >
                          Save name
                        </button>
                      </form>
                    )}
                    {appearances.map((appearance, position) => {
                      const member = members.find(
                        (member) => member.id === appearance.membershipId,
                      )
                      if (!member) return null
                      const agent = data.actorsById[member.actorId]
                      return (
                        <div className="management-row" key={member.id}>
                          <div>
                            <strong>{agent.name}</strong>
                            <small>{agent.id}</small>
                          </div>
                          <div className="order-actions">
                            <button
                              aria-label={`Move ${agent.name} up in ${group.name}`}
                              disabled={blocked || position === 0}
                              onClick={() =>
                                command(
                                  {
                                    type: 'appearance.move',
                                    organizationId: organizationId!,
                                    groupId: group.id,
                                    membershipId: member.id,
                                    direction: 'up',
                                  },
                                  'Appearance order',
                                )
                              }
                            >
                              <Icon name="arrow" size={14} />
                            </button>
                            <button
                              aria-label={`Move ${agent.name} down in ${group.name}`}
                              disabled={
                                blocked || position === appearances.length - 1
                              }
                              onClick={() =>
                                command(
                                  {
                                    type: 'appearance.move',
                                    organizationId: organizationId!,
                                    groupId: group.id,
                                    membershipId: member.id,
                                    direction: 'down',
                                  },
                                  'Appearance order',
                                )
                              }
                            >
                              <Icon
                                name="arrow"
                                size={14}
                                style={{ transform: 'rotate(180deg)' }}
                              />
                            </button>
                            <button
                              disabled={blocked}
                              onClick={() =>
                                command(
                                  {
                                    type: 'appearance.remove',
                                    organizationId: organizationId!,
                                    groupId: group.id,
                                    membershipId: member.id,
                                  },
                                  'Appearance removal',
                                )
                              }
                            >
                              Remove appearance
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <label>
                      Add membership appearance
                      <select
                        aria-label={`Add appearance to ${group.name}`}
                        value=""
                        disabled={blocked}
                        onChange={(e) => {
                          if (e.target.value)
                            command(
                              {
                                type: 'appearance.add',
                                organizationId: organizationId!,
                                groupId: group.id,
                                membershipId: e.target.value,
                              },
                              'Appearance',
                            )
                        }}
                      >
                        <option value="">Choose a member…</option>
                        {members
                          .filter(
                            (member) =>
                              !appearances.some(
                                (a) => a.membershipId === member.id,
                              ),
                          )
                          .map((member) => (
                            <option key={member.id} value={member.id}>
                              {data.actorsById[member.actorId].name} (
                              {member.actorId})
                            </option>
                          ))}
                      </select>
                    </label>
                  </section>
                )
              })}
            </>
          )}
        </div>
        <footer className="management-footer">
          {client.fixture
            ? 'Development fixture · Changes survive page reload, not server restart. No Core connected.'
            : 'Changes target the organization shown above.'}
        </footer>
      </motion.div>
    </dialog>
  )
}
