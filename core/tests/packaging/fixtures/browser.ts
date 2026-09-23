import * as protocol from '@leafos/core/protocol'
import type { JsonObject, JsonValue } from '@leafos/core/protocol'
import { defineClientOptions, type ClientOptions } from '@leafos/core/client'

export const sample: JsonObject = { text: 'foundation', values: [1, true, null] }
export const options: ClientOptions = defineClientOptions({ baseUrl: 'https://leaf.example' })
export const protocolExports = Object.keys(protocol)

// @ts-expect-error undefined is not a JSON value
const invalidValue: JsonValue = undefined
void invalidValue

// @ts-expect-error the URL option must be a string
const invalidOptions: ClientOptions = { baseUrl: 42 }
void invalidOptions

// @ts-expect-error private package files are not public entry points
import type { AdapterIdentity } from '@leafos/core/dist/adapter-api/index.js'
