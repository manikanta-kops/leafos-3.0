import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { workspaceFixture } from './src/demo/management-fixture.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), workspaceFixture()],
  base: './',
  build:
    process.env.LEAFOS_TEST_HARNESS === '1'
      ? { rolldownOptions: { input: ['index.html', 'tests/connection.html'] } }
      : undefined,
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  preview: { host: '127.0.0.1', strictPort: true },
})
