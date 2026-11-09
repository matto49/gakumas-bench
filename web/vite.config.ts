import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 线上挂在 https://api.matto.top/gkbench/，nginx 去掉前缀后转给 Go 服务器
// 开发时 Vite 把 /gkbench/api、/gkbench/sprites 转给本机的 Go 服务器
const backend = process.env.GKBENCH_BACKEND ?? 'http://127.0.0.1:19150'
const strip = (p: string) => p.replace(/^\/gkbench/, '')

export default defineConfig({
  base: '/gkbench/',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/gkbench/api': { target: backend, changeOrigin: true, rewrite: strip },
      '/gkbench/sprites': { target: backend, changeOrigin: true, rewrite: strip },
    },
  },
})
