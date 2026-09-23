import { isTauri } from '@tauri-apps/api/core'
import { browserPlatform } from './browser'
import type { Platform } from './platform'

export async function resolvePlatform(): Promise<Platform> {
  // Load native plugin bindings only when hosted by Tauri.
  if (isTauri()) return (await import('./tauri')).tauriPlatform
  return browserPlatform
}
