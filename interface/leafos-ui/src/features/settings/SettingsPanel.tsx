import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import type { CallerScope, Records } from '../../data/conversations'
import {
  effectiveId,
  settingsId,
  settingFields,
  type ControlClient,
  type SettingsTarget,
  type SettingPatch,
  type Catalog,
} from '../../data/settings'
import type { useControlCommands } from '../../data/use-control-commands'
import type { WorkspaceSnapshot } from '../../data/workspace-client'
import { useDraft } from '../chat/use-draft'
import { Icon } from '../../components/Icon'
import type { Platform } from '../../platform/platform'
import { DesktopPreferences } from './DesktopPreferences'
export type Controls = ReturnType<typeof useControlCommands>
export function Panel({
  title,
  close,
  children,
}: {
  title: string
  close: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.showModal()
    return () => previous?.focus()
  }, [])
  return (
    <motion.dialog
      ref={ref}
      className="settings-panel"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        e.stopPropagation()
        close()
      }}
      initial={{ opacity: 0, x: reduced ? 0 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduced ? 0 : 0.22 }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </motion.dialog>
  )
}
export function SettingsPanel({
  scope,
  scopeKey,
  client,
  records,
  apply,
  commands,
  snapshot,
  organizationId,
  agentId,
  installation,
  platform,
  close,
}: {
  scope: CallerScope
  scopeKey: string
  client?: ControlClient
  records: Records
  apply: (r: Records) => void
  commands: Controls
  snapshot: WorkspaceSnapshot
  organizationId: string | null
  agentId: string | null
  installation: boolean
  platform: Platform
  close: () => void
}) {
  const [tab, setTab] = useState<'organization' | 'agent' | 'desktop'>(
    installation ? 'agent' : 'organization',
  )
  const query = useQuery({
    queryKey: ['settings-read', scopeKey],
    queryFn: async ({ signal }) => {
      const r = await client!.read(scope, signal)
      if (!signal.aborted) apply(r)
      return true
    },
    enabled: !!client,
    retry: false,
  })
  const catalog = useQuery({
    queryKey: ['catalog', scopeKey],
    structuralSharing: (oldData, nextData) => {
      const old = oldData as Catalog | undefined
      const next = nextData as Catalog
      return old && old.revision > next.revision ? old : next
    },
    queryFn: ({ signal }) => client!.catalog(scope, signal),
    enabled: !!client,
    retry: false,
  })
  const target: SettingsTarget | null =
    tab === 'organization'
      ? organizationId
        ? { kind: 'organization', id: organizationId }
        : null
      : agentId
        ? {
            kind:
              installation ||
              snapshot.agentRoles.some((r) => r.agentId === agentId)
                ? 'installation-agent'
                : 'agent',
            id: agentId,
          }
        : null
  const effective = records.effective?.find(
    (e) =>
      e.id === effectiveId(agentId ?? '', installation ? null : organizationId),
  )
  return (
    <Panel title="Settings" close={close}>
      <fieldset className="settings-tabs" aria-label="Settings category">
        {!installation && (
          <button
            aria-pressed={tab === 'organization'}
            onClick={() => setTab('organization')}
          >
            Organization
          </button>
        )}
        <button aria-pressed={tab === 'agent'} onClick={() => setTab('agent')}>
          Global agent
        </button>
        <button
          aria-pressed={tab === 'desktop'}
          onClick={() => setTab('desktop')}
        >
          Notifications
        </button>
      </fieldset>
      {tab === 'desktop' ? (
        <DesktopPreferences platform={platform} scopeKey={scopeKey} />
      ) : (
        <>
          <p className="settings-description">
            {tab === 'organization'
              ? `${snapshot.organizations.find((o) => o.id === organizationId)?.name ?? 'Organization'} defaults and instructions`
              : `${agentId ? snapshot.actorsById[agentId]?.name : 'Agent'} · ${installation ? 'Explicit installation configuration' : 'One global configuration across all organizations'}`}
          </p>
          {!client ? (
            <output>
              Settings service is not configured. Connect a compatible Core
              client.
            </output>
          ) : (
            <>
              {query.isPending && <output>Loading settings…</output>}
              {query.isError && (
                <p role="alert">
                  Settings could not be refreshed.{' '}
                  <button onClick={() => void query.refetch()}>
                    Retry settings
                  </button>
                </p>
              )}
              <div className="catalog-status">
                <span>
                  {catalog.isPending
                    ? 'Loading adapter catalog…'
                    : catalog.isError
                      ? 'Catalog unavailable. Saved selections are retained.'
                      : catalog.data?.stale
                        ? 'Catalog is stale. Check availability before saving.'
                        : `${catalog.data?.adapters.length ?? 0} adapters in catalog`}
                </span>
                <button
                  disabled={catalog.isFetching}
                  onClick={() => void catalog.refetch()}
                >
                  Refresh catalog
                </button>
              </div>
              {target &&
                records.settings?.find((r) => r.id === settingsId(target)) && (
                  <SettingsEditor
                    key={JSON.stringify([scopeKey, target])}
                    scope={scope}
                    scopeKey={scopeKey}
                    target={target}
                    record={records.settings.find(
                      (r) => r.id === settingsId(target),
                    )!}
                    inherited={
                      target.kind === 'agent'
                        ? records.settings.find(
                            (r) => r.id === `organization:${organizationId}`,
                          )?.values
                        : undefined
                    }
                    catalog={catalog.data}
                    commands={commands}
                  />
                )}
              {effective && (
                <section
                  className="effective-settings"
                  aria-label="Effective execution settings"
                >
                  <h3>
                    Effective for{' '}
                    {installation
                      ? 'installation work'
                      : snapshot.organizations.find(
                          (o) => o.id === organizationId,
                        )?.name}
                  </h3>
                  <dl>
                    {settingFields.map((k) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>
                          {effective.values[k] ??
                            (k === 'effort'
                              ? 'No explicit effort'
                              : 'Not set')}{' '}
                          <small>{effective.sources[k] ?? 'No source'}</small>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {effective.reasons.length ? (
                    <ul>
                      {effective.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Ready according to the current catalog.</p>
                  )}
                  <p>
                    New work, Retry and new continuations use current settings.
                    Existing attempts keep their supplied inputs.
                  </p>
                </section>
              )}
            </>
          )}
        </>
      )}
      <p className="settings-footnote">
        {client
          ? 'Development simulation. Settings and inbox are stored only for this fixture process. No Core or execution provider is connected.'
          : 'Core owns settings, instruction files and the notification inbox.'}
      </p>
    </Panel>
  )
}
function SettingsEditor({
  scope,
  scopeKey,
  target,
  record,
  inherited,
  catalog,
  commands,
}: {
  scope: CallerScope
  scopeKey: string
  target: SettingsTarget
  record: NonNullable<Records['settings']>[number]
  inherited?: NonNullable<Records['settings']>[number]['values']
  catalog?: Catalog
  commands: Controls
}) {
  const draft = useDraft(
    JSON.stringify(['settings-draft', scopeKey, target.kind, target.id]),
  )
  const [error, setError] = useState('')
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  let saved: { patch: SettingPatch; operationId?: string } = { patch: {} }
  try {
    if (draft.text) saved = JSON.parse(draft.text)
  } catch {
    /* Preserve malformed local data until explicitly reset. */
  }
  const patch = saved.patch ?? {}
  const entries = commands.entries.filter(
    (e) =>
      e.operation.action === 'settings' &&
      settingsId(e.operation.resource) === settingsId(target),
  )
  const pending = entries.find(
    (e) => !['accepted', 'rejected'].includes(e.state),
  )
  const receipt = entries.find((e) => e.id === saved.operationId)
  useEffect(() => {
    if (receipt?.state === 'accepted' && saved.operationId && draft.text)
      draft.change('')
  }, [receipt?.state, saved.operationId]) // eslint-disable-line react-hooks/exhaustive-deps
  const value = (key: (typeof settingFields)[number]) => {
    const p = patch[key]
    return p ? ('set' in p ? p.set : '') : (record.values[key] ?? '')
  }
  const adapter = catalog?.adapters.find(
    (a) => a.id === (value('adapter') || inherited?.adapter),
  )
  const model = adapter?.models.find(
    (m) => m.id === (value('model') || inherited?.model),
  )
  function change(key: string, val: string) {
    draft.change(
      JSON.stringify({
        patch: {
          ...patch,
          [key]: val || key === 'instructions' ? { set: val } : { clear: true },
        },
      }),
    )
  }
  async function save() {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    const operationId = crypto.randomUUID()
    const operation = {
      operationId,
      action: 'settings' as const,
      target: { ...scope },
      resource: { ...target },
      patch: structuredClone(patch),
    }
    draft.change(JSON.stringify({ patch, operationId }))
    try {
      await draft.prepare()
      await commands.send(operation)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save unavailable.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <section aria-label="Edit execution settings" className="settings-editor">
      {settingFields.map((key) => {
        const options =
          key === 'adapter'
            ? (catalog?.adapters.map((a) => ({
                id: a.id,
                name: a.name,
                available: a.available,
              })) ?? [])
            : key === 'model'
              ? (adapter?.models ?? [])
              : (model?.efforts.map((id) => ({
                  id,
                  name: id,
                  available: true,
                })) ?? [])
        const current = value(key)
        return (
          <label key={key}>
            {key === 'adapter'
              ? 'Execution adapter'
              : key === 'model'
                ? 'Model'
                : 'Effort'}
            <select
              aria-label={
                key === 'adapter'
                  ? 'Execution adapter'
                  : key === 'model'
                    ? 'Model'
                    : 'Effort'
              }
              value={current}
              disabled={busy || !!pending || draft.status === 'loading'}
              onChange={(e) => change(key, e.target.value)}
            >
              <option
                value=""
                disabled={target.kind === 'organization' && key !== 'effort'}
              >
                {target.kind === 'organization'
                  ? key === 'effort'
                    ? 'No effort default'
                    : 'Not configured'
                  : target.kind === 'installation-agent'
                    ? 'Clear explicit value'
                    : 'Inherit organization default'}
              </option>
              {current && !options.some((o) => o.id === current) && (
                <option value={current}>
                  {current} — saved, missing or incompatible
                </option>
              )}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.available ? '' : ' — unavailable'}
                </option>
              ))}
            </select>
            {patch[key] && (
              <small>
                Changed ·{' '}
                {'clear' in patch[key]!
                  ? 'Clear explicit value'
                  : 'Set explicit value'}
              </small>
            )}
          </label>
        )
      })}
      {adapter && (
        <p>
          Capabilities: {adapter.capabilities.join(', ') || 'None reported'}.{' '}
          {adapter.reason}
        </p>
      )}
      {target.kind === 'organization' && (
        <label>
          Organization instructions
          <textarea
            aria-label="Organization instructions"
            rows={6}
            value={patch.instructions?.set ?? record.instructions ?? ''}
            disabled={busy || !!pending || draft.status === 'loading'}
            onChange={(e) => change('instructions', e.target.value)}
          />
          <small>
            Core owns the authoritative instruction file. Changes apply to the
            next execution.
          </small>
        </label>
      )}
      {target.kind !== 'organization' && (
        <p>
          Clear a field to{' '}
          {target.kind === 'installation-agent'
            ? 'leave it unconfigured; installation work does not inherit organization defaults'
            : 'inherit the current organization’s default'}
          . Adapter-specific options are preserved.
        </p>
      )}
      {draft.status === 'error' && (
        <p role="alert">
          Local draft could not be saved.{' '}
          <button onClick={draft.retry}>Retry draft storage</button>
        </p>
      )}
      {draft.status === 'conflict' && (
        <p role="alert">
          This local draft changed in another tab.{' '}
          <button onClick={() => draft.resolve(true)}>Keep my draft</button>
          <button onClick={() => draft.resolve(false)}>Load saved draft</button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {commands.error && (
        <p role="alert">
          {commands.error}
          <button onClick={commands.reload}>Retry recovery storage</button>
        </p>
      )}
      <div className="settings-actions">
        <button
          className="primary-action"
          disabled={
            busy ||
            !!pending ||
            !Object.keys(patch).length ||
            draft.status !== 'saved'
          }
          onClick={() => void save()}
        >
          Save changes
        </button>
        <button
          disabled={busy || !!pending || !Object.keys(patch).length}
          onClick={() => draft.change('')}
        >
          Discard draft
        </button>
      </div>
      {entries.slice(-4).map((e) => (
        <output className="operation-status" key={e.id}>
          {e.state === 'accepted' || e.state === 'rejected'
            ? e.receipt?.status !== 'unknown' && e.receipt?.message
            : `Save ${e.state}. Original fields and request identity are retained.`}
          {!['accepted', 'rejected'].includes(e.state) && (
            <button onClick={() => void commands.retry(e)}>
              Retry original save
            </button>
          )}
        </output>
      ))}
    </section>
  )
}
