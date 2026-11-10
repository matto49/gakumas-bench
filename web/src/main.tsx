import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import { CatalogProvider } from './lib/catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Leaderboard } from './pages/Leaderboard'
import { RunPage } from './pages/Run'
import { Replay } from './pages/Replay'
import { Compare } from './pages/Compare'
import { Me } from './pages/Me'
import { NotFound } from './pages/NotFound'

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { path: '/', element: <Home /> },
        { path: '/sets', element: <Leaderboard /> },
        { path: '/sets/:set', element: <Leaderboard /> },
        { path: '/runs/:run', element: <RunPage /> },
        { path: '/runs/:run/:problem/:seed', element: <Replay /> },
        { path: '/compare', element: <Compare /> },
        { path: '/me', element: <Me /> },
        { path: '/leaderboard', element: <Navigate to="/sets" replace /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CatalogProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </CatalogProvider>
  </StrictMode>,
)
