import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// 线上挂在 https://gakumas.wiki/ 根路径，nginx 整站转给 Go 服务器（2026-11-20 从 hiro.matto.top/gkbench/ 迁来）
// 开发时 Vite 把 /api、/sprites 转给本机的 Go 服务器
const backend = process.env.GKBENCH_BACKEND ?? 'http://127.0.0.1:19150'

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/sprites': { target: backend, changeOrigin: true },
    },
  },
})
