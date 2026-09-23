/** Package metadata only; it does not establish runtime compatibility or readiness. */
export interface AdapterIdentity {
  readonly id: string
  readonly version: string
}

/** Provisional factory contract with explicit host injection and no runtime initialization. */
export type AdapterFactory<Host, Adapter> = (host: Host) => Adapter | Promise<Adapter>
