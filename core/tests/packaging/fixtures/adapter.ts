import type { AdapterFactory, AdapterIdentity } from '@leafos/core/adapter'

// These are fixture-only operations, not the production execution/host API.
interface FixtureHost {
  record(value: string): void
}

interface FixtureAdapter extends AdapterIdentity {
  record(): void
}

export const createFixtureAdapter: AdapterFactory<FixtureHost, FixtureAdapter> = (host) => ({
  id: 'packaging-fixture',
  version: '0.0.0',
  record() {
    host.record('fixture used the supplied host')
  },
})
