import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from './workspace-hooks'
import {
  CommandError,
  type CommandResult,
  type WorkspaceOperation,
} from './management'
import { managementJournal, type PendingManagement } from './management-journal'
import type { WorkspaceSnapshot } from './workspace-client'

export function useManagement(data: WorkspaceSnapshot) {
  const { client } = useWorkspace()
  const queries = useQueryClient()
  const scope = JSON.stringify([
    client.connectionKey,
    data.installationId,
    data.currentHumanId,
  ])
  const actorScope = {
    installationId: data.installationId,
    callerId: data.currentHumanId,
  }
  const [pending, setPending] = useState<PendingManagement | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void managementJournal.read(scope).then(
      (value) => {
        if (!cancelled) {
          setPending(value)
          setReady(true)
        }
      },
      () => {
        if (!cancelled)
          setError(
            'Recovery storage is unavailable. Management is disabled; navigation still works.',
          )
      },
    )
    return () => {
      cancelled = true
      alive.current = false
    }
  }, [scope])
  async function transition(
    expected: PendingManagement | null,
    next: PendingManagement | null,
  ) {
    const result = await managementJournal.transition(scope, expected, next)
    if (alive.current) setPending(result.current)
    return result
  }
  async function reconcile(result: CommandResult, entry: PendingManagement) {
    if (
      result.commandId !== entry.command.commandId ||
      result.installationId !== entry.command.installationId ||
      result.callerId !== entry.command.callerId ||
      result.workspace.installationId !== result.installationId ||
      result.workspace.currentHumanId !== result.callerId
    )
      throw new CommandError(
        'The acknowledgement belongs to another context. The original outcome remains unknown.',
        'unknown',
        'scope-mismatch',
      )
    const operationType = entry.command.operation.type
    if (
      (operationType === 'agent.create' &&
        (!result.resourceId ||
          result.workspace.actorsById[result.resourceId]?.kind !== 'agent')) ||
      (operationType === 'organization.create' &&
        !result.workspace.organizations.some(
          (org) => org.id === result.resourceId,
        ))
    )
      throw new CommandError(
        'The created identity was not acknowledged. Check the original request.',
        'unknown',
        'missing-identity',
      )
    if (
      entry.command.operation.type === 'agent.create' &&
      entry.addToOrganization
    ) {
      if (!result.resourceId)
        throw new CommandError(
          'Agent identity was not acknowledged.',
          'unknown',
          'missing-identity',
        )
      await transition(entry, {
        ...entry,
        createdAgentId: result.resourceId,
        state: 'add-ready',
        message:
          'Global agent created. Add this identity to the original organization to finish enrollment.',
      })
    } else {
      const completion = await transition(entry, null)
      if (alive.current && completion.applied) {
        setNotice(`${entry.label} saved.`)
      }
    }
    if (!alive.current) return
    // Receipts can contain historical snapshots. Fetch the current projection instead;
    // one unresolved command per scope serializes this client's management writes.
    await queries.cancelQueries({
      queryKey: ['workspace', client.connectionKey],
    })
    await Promise.all([
      queries.invalidateQueries({
        queryKey: ['workspace', client.connectionKey],
      }),
      queries.invalidateQueries({ queryKey: ['agent-catalog'] }),
    ])
  }
  async function perform(
    entry: PendingManagement,
    check = false,
    expected: PendingManagement | null = null,
  ) {
    if (!client.management || lock.current) return false
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const reserved = await transition(expected, entry)
      if (!reserved.applied || !reserved.current) {
        setError(
          'This recovery step changed in another tab. The current outcome is shown; no request was sent.',
        )
        lock.current = false
        setBusy(false)
        return false
      }
      entry = reserved.current // Dispatch only the exact atomically reserved revision.
    } catch {
      setError(
        'Could not save recovery information. No request was sent. Your input is retained. Storage may be unavailable, or another tab has a pending request; reload to recover it.',
      )
      lock.current = false
      setBusy(false)
      return false
    }
    try {
      const result = check
        ? await client.management.readCommand(
            entry.command.commandId,
            entry.command,
            new AbortController().signal,
          )
        : await client.management.execute(
            entry.command,
            new AbortController().signal,
          )
      if (result) await reconcile(result, entry)
      else
        await transition(entry, {
          ...entry,
          state: 'unknown',
          message:
            'No receipt is available. This does not prove the request failed. Do not recreate it; check the original service. Development fixture receipts are lost on server restart.',
        })
      return !!result
    } catch (cause) {
      const rejected =
        cause instanceof CommandError && cause.outcome === 'rejected'
      const message =
        cause instanceof Error
          ? cause.message
          : 'The request outcome is unknown.'
      await transition(entry, {
        ...entry,
        state: rejected && !check ? 'rejected' : 'unknown',
        message,
      }).catch(() => {
        if (alive.current)
          setError(
            'Recovery update failed. The original request remains saved as unresolved.',
          )
      })
      return false
    } finally {
      lock.current = false
      if (alive.current) setBusy(false)
    }
  }
  return {
    pending,
    busy,
    ready,
    error,
    notice,
    available: !!client.management,
    async submit(
      operation: WorkspaceOperation,
      label: string,
      addToOrganization?: string,
    ) {
      if (!ready || pending || lock.current) return false
      return perform({
        scope,
        journalId: crypto.randomUUID(),
        command: { ...actorScope, commandId: crypto.randomUUID(), operation },
        label,
        addToOrganization,
        state: 'unknown',
        message:
          'Waiting for acknowledgement. Closing this dialog does not cancel the request.',
      })
    },
    check: () =>
      pending && pending.state === 'unknown' && perform(pending, true, pending),
    addCreated: () =>
      pending?.state === 'add-ready' &&
      pending.createdAgentId &&
      pending.addToOrganization &&
      perform(
        {
          ...pending,
          command: {
            ...actorScope,
            commandId: crypto.randomUUID(),
            operation: {
              type: 'membership.add',
              organizationId: pending.addToOrganization,
              agentId: pending.createdAgentId,
            },
          },
          state: 'unknown',
          message: 'Adding the existing global identity…',
        },
        false,
        pending,
      ),
    async keepAgent() {
      if (
        !pending?.createdAgentId ||
        !['add-ready', 'rejected'].includes(pending.state) ||
        lock.current
      )
        return
      lock.current = true
      try {
        const result = await transition(pending, null)
        if (alive.current && result.applied)
          setNotice('Global agent kept without adding membership.')
      } catch {
        setError(
          'Recovery storage could not be updated. The saved request is retained.',
        )
      } finally {
        lock.current = false
      }
    },
    async dismissRejected() {
      if (!pending || pending.state !== 'rejected' || busy) return
      try {
        if (pending.createdAgentId) {
          await transition(pending, {
            ...pending,
            state: 'add-ready',
            message: 'The agent exists. Retry adding this identity when ready.',
          })
        } else {
          await transition(pending, null)
        }
      } catch {
        setError(
          'Recovery storage could not be updated. The saved request is retained.',
        )
      }
    },
  }
}
