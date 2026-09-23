# LeafOS Core

The backend package for LeafOS. It currently provides protocol types, client
configuration and an adapter contract; runtime services are not implemented yet.
Core manages its own dependencies and lockfile.

## Development

Use NVM to select the Node version pinned in `.nvmrc`:

```sh
cd core
nvm install
nvm use
npm ci
npm run check
```

- `npm run build` emits JavaScript and TypeScript declarations into `dist/`.
- `npm run check` runs type checks, import-boundary checks, unit tests and
  isolated package-consumer tests.
- `npm pack` validates and builds Core before creating a local package tarball.

## Public exports

| Import | Contents |
| --- | --- |
| `@leafos/core/protocol` | JSON value types. |
| `@leafos/core/client` | JSON types and `defineClientOptions` for HTTP(S) URL configuration. |
| `@leafos/core/adapter` | Adapter identity and a provisional factory type for injected host services. |

JSON types describe values at compile time; they do not validate runtime input.
`defineClientOptions` normalizes a backend URL without making network requests.

## Boundaries

- Protocol and client exports stay browser-safe and free of backend imports.
- Domain modules access other modules through `public.ts` and cannot import
  transports, runtime composition or cross-module workflows.
- Adapters receive host services explicitly; importing a contract must not
  create a Core runtime.

The package tests install a tarball outside the repository and verify exports,
declarations, import side effects, browser bundling and adapter host injection.
