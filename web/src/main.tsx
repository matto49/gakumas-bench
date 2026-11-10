import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import { CatalogProvider } from './lib/catalog'
import { SetsProvider } from './lib/sets'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Leaderboard } from './pages/Leaderboard'
import { RunPage } from './pages/Run'
import { Replay } from './pages/Replay'
import { Compare } from './pages/Compare'
import { Cards } from './pages/Cards'
import { ExamSet, Exams } from './pages/Exams'
import { Me } from './pages/Me'
import { CliLogin } from './pages/CliLogin'
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
        { path: '/cards', element: <Cards /> },
        { path: '/exams', element: <Exams /> },
        { path: '/exams/:set', element: <ExamSet /> },
        { path: '/me', element: <Me /> },
        { path: '/cli-login', element: <CliLogin /> },
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
      <SetsProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
      </SetsProvider>
    </CatalogProvider>
  </StrictMode>,
)
