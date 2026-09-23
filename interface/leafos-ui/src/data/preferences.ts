import Dexie, { type Table } from 'dexie'
import {
  parseNavigation,
  type Navigation,
} from '../features/workspace/navigation'

const db = new Dexie('leafos-client') as Dexie & {
  navigation: Table<{ scope: string; value: Navigation }, string>
}
db.version(1).stores({ navigation: '&scope' })

export const navigationPreferences = {
  async read(scope: string) {
    return parseNavigation((await db.navigation.get(scope))?.value)
  },
  async write(scope: string, value: Navigation) {
    await db.navigation.put({ scope, value })
  },
}

export interface NavigationPreferences {
  read(scope: string): Promise<Navigation>
  write(scope: string, value: Navigation): Promise<void>
}

type PendingWrite = { value: Navigation; settled: Promise<void> }
// Shared across remounts: a returning scope must not read behind its own pending writes.
const pendingWrites = new WeakMap<
  NavigationPreferences,
  Map<string, PendingWrite>
>()

export function readPreferences(
  preferences: NavigationPreferences,
  scope: string,
) {
  const pending = pendingWrites.get(preferences)?.get(scope)
  return pending ? Promise.resolve(pending.value) : preferences.read(scope)
}

export function persistPreferences(
  preferences: NavigationPreferences,
  scope: string,
  value: Navigation,
) {
  let scopes = pendingWrites.get(preferences)
  if (!scopes) {
    scopes = new Map()
    pendingWrites.set(preferences, scopes)
  }
  const previous = scopes.get(scope)
  const settled = (previous?.settled ?? Promise.resolve())
    .catch(() => {})
    .then(() => preferences.write(scope, value))
  const entry = { value, settled }
  scopes.set(scope, entry)
  const clear = () => {
    if (scopes.get(scope) === entry) scopes.delete(scope)
  }
  void settled.then(clear, clear)
  return settled
}
