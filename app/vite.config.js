import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative asset paths, so the same build works at sworn.nerom.site and on a DeWEB gateway.
export default defineConfig({
  base: './',
  plugins: [react()],
})
