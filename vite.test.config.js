import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'
// Test-only config: the app code without the Base44 plugin, with a local
// stand-in for the Base44 client so pages render without a backend.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/api/base44Client', replacement: path.resolve(import.meta.dirname, 'test/base44Mock.js') },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
})
