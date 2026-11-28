import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'
import { execSync } from 'node:child_process'

// The version shown in the app: Netlify's commit (COMMIT_REF), else the
// local git commit, plus the build date. Tells at a glance whether the
// browser is running the latest update.
function buildVersion() {
  let commit = process.env.COMMIT_REF || ''
  if (!commit) { try { commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { commit = 'dev' } }
  return `${commit.slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
})
