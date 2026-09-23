import type { ReactNode } from 'react'
import { Management } from './Management'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Icon } from '../../components/Icon'
import { Avatar } from '../chat/Message'
import type { Agent } from '../chat/model'
import type { WorkspaceSnapshot } from '../../data/workspace-client'

interface Props {
  utilities: ReactNode
  data: WorkspaceSnapshot
  organizationId: string | null
  selectedAgentId: string | null
  selectedTarget: 'organization' | 'installation'
  collapsed: boolean
  closedGroups: string[]
  onToggle: () => void
  onOrganization: (id: string) => void
  onAgent: (id: string, target: 'organization' | 'installation') => void
  onGroup: (id: string) => void
  connectionStatus: 'ready' | 'reconnecting' | 'unavailable' | 'offline'
  fixture: boolean
  reconnect: () => void
}

export function Sidebar({
  utilities,
  data,
  organizationId,
  selectedAgentId,
  selectedTarget,
  collapsed,
  closedGroups,
  onToggle,
  onOrganization,
  onAgent,
  onGroup,
  connectionStatus,
  fixture,
  reconnect,
}: Props) {
  const reduceMotion = useReducedMotion()
  const memberships = data.memberships.filter(
    (m) =>
      m.organizationId === organizationId &&
      data.actorsById[m.actorId]?.kind === 'agent',
  )
  const groups = data.groups.filter(
    (group) => group.organizationId === organizationId,
  )
  const assigned = new Set(
    data.groupAssignments
      .filter((a) => groups.some((g) => g.id === a.groupId))
      .map((a) => a.membershipId),
  )
  const ungrouped = memberships.filter((m) => !assigned.has(m.id))
  const organization = data.organizations.find(
    (org) => org.id === organizationId,
  )
  const duplicateName = (agent: Agent) =>
    memberships.filter((m) => data.actorsById[m.actorId]?.name === agent.name)
      .length > 1
  function agentButton(agent: Agent, admin = false) {
    const selected =
      selectedAgentId === agent.id &&
      selectedTarget === (admin ? 'installation' : 'organization')
    const label = duplicateName(agent)
      ? `${agent.name} (${agent.id})`
      : agent.name
    return (
      <motion.button
        key={agent.id}
        className={`agent-button ${admin ? 'admin-button' : ''} ${selected ? 'selected' : ''}`}
        aria-label={label}
        title={label}
        aria-current={selected ? 'page' : undefined}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        onClick={() =>
          onAgent(agent.id, admin ? 'installation' : 'organization')
        }
      >
        {admin ? (
          <Icon name="spark" weight={selected ? 'fill' : 'duotone'} />
        ) : (
          <Avatar name={agent.name} color={agent.color} />
        )}
        <span className="sidebar-label agent-name">
          {agent.name}
          {duplicateName(agent) && <small>{agent.id}</small>}
        </span>
        {selected && <span className="selection-marker" aria-hidden="true" />}
      </motion.button>
    )
  }
  return (
    <motion.aside
      layout={reduceMotion ? false : 'position'}
      className="sidebar"
      aria-label="Workspace"
    >
      <div className="brand">
        <span className="brand-mark">
          <Icon name="leaf" weight="duotone" />
        </span>
        <span className="sidebar-label wordmark">LeafOS</span>
        <button
          className="icon-button collapse-button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <Icon name="panel" />
        </button>
      </div>
      <nav aria-label="Agents">
        <div className="installation-agents">
          {data.agentRoles.map((role) =>
            agentButton(data.actorsById[role.agentId] as Agent, true),
          )}
        </div>
        <div className="nav-heading sidebar-label">
          Agents <span>{memberships.length}</span>
        </div>
        <div className="expanded-agents">
          {groups.map((group) => {
            const members = data.groupAssignments
              .filter((a) => a.groupId === group.id)
              .flatMap((a) => {
                const member = memberships.find((m) => m.id === a.membershipId)
                return member ? [member] : []
              })
            const closed = closedGroups.includes(group.id)
            return (
              <section
                className="agent-group"
                aria-label={group.name}
                key={group.id}
              >
                <button
                  className="group-heading"
                  aria-expanded={!closed}
                  aria-controls={`group-${group.id}`}
                  onClick={() => onGroup(group.id)}
                >
                  <Icon name="folder" />
                  <span>{group.name}</span>
                  {closed &&
                    members.some((m) => m.actorId === selectedAgentId) && (
                      <span className="group-selected" aria-hidden="true" />
                    )}
                  <Icon
                    name="chevron"
                    className={closed ? 'group-caret closed' : 'group-caret'}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {!closed && (
                    <motion.div
                      id={`group-${group.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.18 }}
                      className="group-contents"
                    >
                      {members.length ? (
                        members.map((m) =>
                          agentButton(data.actorsById[m.actorId] as Agent),
                        )
                      ) : (
                        <p className="sidebar-empty">
                          No agents in this group.
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )
          })}
          {ungrouped.length > 0 && (
            <section className="agent-group" aria-label="Ungrouped">
              <div className="group-heading">
                <Icon name="folder" />
                <span>Ungrouped</span>
              </div>
              {ungrouped.map((m) =>
                agentButton(data.actorsById[m.actorId] as Agent),
              )}
            </section>
          )}
          {!memberships.length && (
            <p className="sidebar-empty">
              {organization
                ? 'No agents here yet.'
                : 'No organization selected.'}
            </p>
          )}
        </div>
        <div className="rail-agents">
          {Array.from(new Set(memberships.map((m) => m.actorId))).map((id) =>
            agentButton(data.actorsById[id] as Agent),
          )}
        </div>
      </nav>
      <div className="sidebar-footer">
        {utilities}
        <Management data={data} organizationId={organizationId} />
        <div
          className={`workspace-connection ${connectionStatus}`}
          title={
            connectionStatus === 'ready'
              ? fixture
                ? 'Development fixture · No Core connected'
                : 'Workspace loaded'
              : 'Workspace ' + connectionStatus
          }
        >
          <span className="connection-indicator" aria-hidden="true" />
          <span className="sidebar-label">
            {connectionStatus === 'ready'
              ? fixture
                ? 'Development fixture'
                : 'Workspace loaded'
              : connectionStatus === 'reconnecting'
                ? 'Refreshing workspace…'
                : 'Workspace unavailable'}
          </span>
          <button
            className="icon-button"
            aria-label="Refresh workspace"
            title="Refresh workspace"
            onClick={reconnect}
            disabled={connectionStatus === 'reconnecting'}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
        {connectionStatus !== 'ready' &&
          connectionStatus !== 'reconnecting' && (
            <output className="sidebar-label sidebar-empty">
              Showing the last loaded workspace. Try refreshing.
            </output>
          )}
        <div className="profile-picker">
          <span className="organization-monogram" aria-hidden="true">
            {organization?.name
              .split(/\s+/)
              .map((word) => word[0])
              .slice(0, 2)
              .join('') ?? '—'}
          </span>
          <Avatar name={data.actorsById[data.currentHumanId].name} isSelf />
          <div className="profile-context sidebar-label">
            <strong>{data.actorsById[data.currentHumanId].name}</strong>
            <span>{organization?.name ?? 'No organization'}</span>
          </div>
          <Icon name="chevron" className="profile-caret" />
          <select
            aria-label="Organization"
            title={organization?.name ?? 'Organization'}
            value={organizationId ?? ''}
            onChange={(event) => onOrganization(event.target.value)}
            disabled={!data.organizations.length}
          >
            {!data.organizations.length && (
              <option value="">No organizations</option>
            )}
            {data.organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
                {data.organizations.filter((o) => o.name === org.name).length >
                1
                  ? ` (${org.id})`
                  : ''}
              </option>
            ))}
          </select>
        </div>
        <div
          className="rail-profile"
          title={data.actorsById[data.currentHumanId].name}
        >
          <Avatar name={data.actorsById[data.currentHumanId].name} isSelf />
        </div>
        <p className="fixture-caption sidebar-label">
          {fixture
            ? 'Sample data · No Core connected'
            : 'Connection status is separate from agent activity.'}
        </p>
      </div>
    </motion.aside>
  )
}
