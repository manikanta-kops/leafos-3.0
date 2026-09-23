import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { checkBoundaries } from '../scripts/check-boundaries.mjs'

function check(t, sources) {
  const root = mkdtempSync(path.join(tmpdir(), 'leafos-boundaries-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(sources)) {
    const filename = path.join(root, name)
    mkdirSync(path.dirname(filename), { recursive: true })
    writeFileSync(filename, content)
  }
  return checkBoundaries(root)
}

test('public module access, owned internals, and protocol imports are allowed', (t) => {
  assert.deepEqual(check(t, {
    'protocol/index.ts': 'export type Value = string',
    'protocol/client/index.ts': 'export type { Value } from "../index.js"',
    'adapter-api/index.ts': 'export type { Value } from "@leafos/core/protocol"',
    'modules/work/public.ts': 'export { state } from "./state.js"',
    'modules/work/state.ts': 'export const state = "idle"',
    'modules/conversations/public.ts': 'export { state } from "../work/public.js"',
    'workflows/submit.ts': 'export { state } from "../modules/work/public.js"',
  }), [])
})

for (const statement of [
  'import "node:fs"',
  'export * from "node:fs"',
  'import type { Stats } from "node:fs"',
  'type Stats = import("node:fs").Stats',
  'void import("node:fs")',
  'require("fs")',
]) {
  test(`browser boundary rejects ${statement}`, (t) => {
    assert.match(check(t, { 'protocol/index.ts': statement }).join('\n'), /browser surface/)
  })
}

test('browser imports cannot reach backend code through a barrel', (t) => {
  assert.match(check(t, {
    'protocol/index.ts': 'export * from "./bridge.js"',
    'protocol/bridge.ts': 'export * from "../platform/files.js"',
    'platform/files.ts': 'import "node:fs"',
  }).join('\n'), /browser surface protocol\/index.ts cannot depend on platform/)
})

for (const layer of ['transport', 'runtime', 'workflows']) {
  test(`domain cannot reach ${layer} through shared code`, (t) => {
    assert.match(check(t, {
      'modules/work/public.ts': 'import "../../shared/helper.js"',
      'shared/helper.ts': `import "../${layer}/entry.js"`,
      [`${layer}/entry.ts`]: 'export {}',
    }).join('\n'), /domain module work cannot depend on/)
  })
}

for (const caller of ['modules/conversations/public.ts', 'workflows/submit.ts']) {
  test(`${caller} cannot access another module's private file`, (t) => {
    const prefix = caller.startsWith('modules/') ? '..' : '../modules'
    assert.match(check(t, {
      [caller]: `import "${prefix}/work/repository.js"`,
      'modules/work/repository.ts': 'export {}',
    }).join('\n'), /through modules\/work\/public.ts/)
  })
}

test('adapter contract cannot construct a runtime through an import', (t) => {
  assert.match(check(t, {
    'adapter-api/index.ts': 'import "../runtime/index.js"',
    'runtime/index.ts': 'export {}',
  }).join('\n'), /public adapter contract cannot depend on runtime/)
})

test('computed imports are reported instead of silently skipped', (t) => {
  assert.match(check(t, { 'protocol/index.ts': 'import(target)' }).join('\n'), /inspectable literal/)
})

test('unknown aliases, private package imports and missing files fail closed', (t) => {
  assert.match(check(t, { 'modules/work/public.ts': 'import "#runtime"' }).join('\n'), /undeclared or private/)
  assert.match(check(t, { 'modules/work/public.ts': 'import "@leafos/core/dist/runtime.js"' }).join('\n'), /undeclared or private/)
  assert.match(check(t, { 'protocol/index.ts': 'import "./missing.js"' }).join('\n'), /cannot resolve/)
})
