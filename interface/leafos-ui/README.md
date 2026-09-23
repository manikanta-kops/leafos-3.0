# LeafOS UI

React/TypeScript client with a small Tauri host boundary. Workspace discovery, management, conversations and work controls currently use an explicitly labelled development HTTP fixture. Core is an independent backend; this preview does not run agents or establish backend readiness.

## Run

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev                       # Loopback UI and development HTTP fixture
npm run check                     # Lint, formatting, TypeScript, production build
npm run build:demo                # Explicit fixture-enabled static build
npm run preview:demo -- --port 4196
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

The browser tests build their own fixture preview on port 4187. Use `npx playwright install chromium` and omit `PLAYWRIGHT_CHANNEL` if Chrome is not installed. Environment assignments shown here use POSIX shell syntax.

`npm run build` produces an unconfigured client, without fixture fallback. `VITE_WORKSPACE_URL` may point at an HTTP(S) endpoint implementing the provisional navigation projection. It is **not** an existing Core route. `npm run preview` serves that build without fixture middleware. A real integration still needs agreed Core discovery/management/conversation contracts and packaged connectivity validation.

## Client composition

- `app/App.tsx` injects the workspace client and platform services.
- `data/workspace-client.ts` defines the replaceable `WorkspaceClient.readWorkspace(signal)` seam and validates the response. It contains installation/caller identity, organizations, actors, roles, memberships, groups and ordered appearances; no conversation history.
- `data/management.ts` defines optional UI-only management and global-agent catalog capabilities. The HTTP implementation is fixture-only, not a Core API. The process-memory fixture preserves writes and command receipts across frontend reloads, but loses them on server restart.
- A scoped Dexie recovery journal is saved before dispatch. Uncertain requests are checked by their original ID, never automatically replayed; a missing receipt stays unresolved. Create-and-add preserves the acknowledged global agent ID before the separate membership action.
- TanStack Query owns fetched workspace snapshots and reconnect queries. The normalized destination URL identifies each connection; responses from an obsolete connection are cancelled and isolated.
- `features/workspace` owns navigation, sidebar and workspace presentation. Zustand holds navigation only. Dexie persists preferences under destination, installation and caller identity. Invalid selections are reconciled against the latest snapshot. Conversation snapshots and replay cursors are rebuilt after reload.
- `data/conversations.ts` defines an injected, provisional conversation client. TanStack Query stores normalized chats, threads, messages and artifact references; the root feed and thread pane use bounded history pages. Opening one agent through multiple groups resolves the same direct chat. Root-admin targeting retains installation context when organizations change.
- `data/work.ts` defines UI-local work, queue, activity, delegation and choice-card contracts. Work controls use a separate immutable Dexie journal with atomic transitions, read-only receipt checks and explicit same-command retries. Backend state and available actions drive controls; messages and reactions never complete work.
- `platform` contains host services; [platform adapters](docs/platform-adapters.md) covers desktop attention and Tauri setup.

Organization/agent selection, group disclosure and sidebar preferences restore after reload. Theme is a device-local preference. Text drafts and immutable pending submissions survive reload in Dexie, scoped to destination, installation, caller and conversation target. Concurrent draft edits offer explicit conflict recovery. Sends reserve durable local state before dispatch; uncertain outcomes use read-only receipt reconciliation and explicit retry with the original ID and payload. Reconnection refreshes snapshots and resumes one application stream plus one open-thread stream; it never dispatches work.

The development HTTP fixture keeps accepted history and receipts in process memory only. Server restart loses them; a missing receipt is not proof of rejection or production durability. Media uses a replaceable UI-local client: original Blobs and immutable upload intents are saved in scoped Dexie records before binary transfer. Stable artifact IDs, verified downloads, safe raster/audio/video previews and explicit voice-note preparation are exercised by the fixture. Uploaded ownership is explicitly unassigned in this fixture; this chooses no production ownership policy. Work examples include questions, approvals, cancellation settlement, queue holds and retry continuation. Failure holds same-thread follow-ups; Retry continues the FIFO queue after safe success, unless superseded by Stop or another hold. These are HTTP fixture transitions, not durable Core scheduling, provider cancellation, execution or safe external-effect recovery. Voice preparation is simulated; no Spokenly service or real Core storage, queue, transcription or execution is connected. Preparing messages retain their original queue position, and late transcripts never submit a second user message. The fixture advertises its own upload limit. Frontend recovery does not establish backend restart durability.

Phosphor icons, Motion, reduced motion, light/dark Iris & Graphite surfaces and keyboard/IME behavior are shared across the browser and desktop UI. Designed initials provide accessible avatar fallbacks. Original alpine artwork is decorative; continuous reading veils preserve contrast. Browser verification does not establish packaged Windows/macOS/Linux release support.

## Settings and notifications

Settings exposes organization defaults/instructions, global agent overrides, and explicit installation-agent configuration. Catalog metadata supplies adapter/model/effort choices and availability; missing selections remain visible without fallback. Only edited fields are saved. Agent clears restore inheritance; an organization can explicitly remove its optional effort default. Provider options remain untouched. Effective values and sources come from the injected client, with revisions used only to order projections—not to reject stale settings edits.

The UI-local `ControlClient` is replaceable; its HTTP implementation is fixture-only. Core must supply authoritative settings/instruction-file writes, catalogs, durable notification records and receipts. Scoped local drafts and operation journals preserve uncertain saves/read updates; automatic recovery reads receipts and explicit retry retains the original operation. Fixture attempts expose simulated supplied settings for new admission, retry and continuation; no real execution is connected.

The bell opens a canonical inbox for completion, questions/approvals, failure and recovery. Opening an item leaves its read state unchanged; **Mark read** never resolves an interaction. Links load the original context and current target state. One application stream carries these updates; reload and replay recovery restore history without historical popup bursts. Desktop alerts require explicit enable/test; background dispatch never requests permission. Same-browser delivery claims suppress duplicate attempts across tabs, but neither OS visibility nor cross-device deduplication is guaranteed. Fully closed delivery and native notification-click routing are not implemented.
