import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import LandingPage from '@/pages/LandingPage'
import DashboardPage from '@/pages/DashboardPage'
import TemplatePickerPage from '@/pages/TemplatePickerPage'

function ExternalRedirect({ to }: { to: string }) {
  window.location.replace(to)
  return <div className="min-h-screen flex items-center justify-center"><span className="text-sm text-gray-500">Redirecting…</span></div>
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>
  if (!isAuthenticated) return <ExternalRedirect to="https://accounts.zenventora.in/login?view=signin&product=emenu&returnTo=https%3A%2F%2Femenu.zenventora.in%2F" />
  return <>{children}</>
}

function LoadingSpinner() {
  return <div className="flex flex-col items-center gap-3"><div className="w-10 h-10 rounded-full border-4 border-brand-teal/20 border-t-brand-teal animate-spin" /><span className="text-sm text-gray-500">Loading...</span></div>
}

export default function App() {
  useAuth()
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<ExternalRedirect to="https://accounts.zenventora.in/login?view=signin&product=emenu&returnTo=https%3A%2F%2Femenu.zenventora.in%2F" />} />
      <Route path="/signup" element={<ExternalRedirect to="https://zenventora.in/emenu/signup.html" />} />
      <Route path="/signup.html" element={<ExternalRedirect to="https://zenventora.in/emenu/signup.html" />} />
      <Route path="/forgot-password" element={<ExternalRedirect to="https://accounts.zenventora.in/forgot?view=forgot&product=emenu&returnTo=https%3A%2F%2Femenu.zenventora.in%2F" />} />
      <Route path="/reset-password" element={<ExternalRedirect to="https://accounts.zenventora.in/forgot?view=forgot&product=emenu&returnTo=https%3A%2F%2Femenu.zenventora.in%2F" />} />
      <Route path="/menu/:slug" element={<div>Menu View — Coming Soon</div>} />
      <Route path="/onboarding/template" element={<ProtectedRoute><TemplatePickerPage /></ProtectedRoute>} />
      <Route path="/dashboard/*" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}