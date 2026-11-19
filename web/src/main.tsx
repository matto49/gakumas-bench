import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query'
import { CatalogProvider } from './lib/catalog'
import { SetsProvider } from './lib/sets'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'

/** 除首页外，每个页面单独打包，打开时才下载（React Router 的 lazy 路由）。首页和顶栏在主包里，进站最快 */
const page = <M, K extends keyof M>(load: () => Promise<M>, name: K) => async () => ({ Component: (await load())[name] as React.ComponentType })

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { path: '/', element: <Home /> },
        { path: '/about', lazy: page(() => import('./pages/About'), 'About') },
        { path: '/usage', lazy: page(() => import('./pages/Usage'), 'Usage') },
        { path: '/tiers', lazy: page(() => import('./pages/Tiers'), 'TiersIndex') },
        { path: '/tiers/:board', lazy: page(() => import('./pages/Tiers'), 'Tiers') },
        { path: '/tiers/:board/:card', lazy: page(() => import('./pages/TierCard'), 'TierCardPage') },
        { path: '/sets', lazy: page(() => import('./pages/Leaderboard'), 'Leaderboard') },
        { path: '/sets/:set', lazy: page(() => import('./pages/Leaderboard'), 'Leaderboard') },
        { path: '/runs/:run', lazy: page(() => import('./pages/Run'), 'RunPage') },
        { path: '/runs/:run/:problem/:seed', lazy: page(() => import('./pages/Replay'), 'Replay') },
        { path: '/compare', lazy: page(() => import('./pages/Compare'), 'Compare') },
        { path: '/cards', lazy: page(() => import('./pages/Cards'), 'Cards') },
        { path: '/exams', lazy: page(() => import('./pages/Exams'), 'Exams') },
        { path: '/exams/:set', lazy: page(() => import('./pages/Exams'), 'ExamSet') },
        { path: '/me', lazy: page(() => import('./pages/Me'), 'Me') },
        { path: '/cli-login', lazy: page(() => import('./pages/CliLogin'), 'CliLogin') },
        { path: '/leaderboard', element: <Navigate to="/sets" replace /> },
        { path: '*', lazy: page(() => import('./pages/NotFound'), 'NotFound') },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
    <CatalogProvider>
      <SetsProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
      </SetsProvider>
    </CatalogProvider>
    </QueryClientProvider>
  </StrictMode>,
)
