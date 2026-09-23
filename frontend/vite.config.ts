import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc' // 이 부분이 swc로 바뀌어야 합니다.
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    host: true, // 0.0.0.0 바인딩 — 다른 기기에서도 접속 가능
    proxy: {
      // /api, /ws 요청을 백엔드(8000)로 프록시 → 브라우저는 항상 dev 서버 호스트로만 요청
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'CCATFARM',
        short_name: 'CCATFARM',
        description: 'CCATFARM PWA Application',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})