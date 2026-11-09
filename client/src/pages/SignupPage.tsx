import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

export default function SignupPage() {
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.setUser)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const response = await api.post('/auth/signup', { name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password })
      if (response.data?.requiresVerification) {
        setMessage(response.data.message || 'Check your email and verify your address. Return here after verification to sign in.')
        return
      }
      if (response.data?.user) {
        setUser(response.data.user)
        navigate('/dashboard', { replace: true })
      } else {
        setMessage('Account created. Please sign in to continue.')
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'We could not create your account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#071b31] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl grid md:grid-cols-2">
        <section className="hidden md:flex flex-col justify-between bg-gradient-to-br from-[#103f68] to-[#078f91] p-10 text-white">
          <div className="text-xl font-extrabold tracking-tight">ZenVentora <span className="text-white/70">eMenu</span></div>
          <div><p className="mb-3 text-xs font-bold uppercase tracking-[.22em] text-white/75">Your menu. Your business.</p><h1 className="text-4xl font-black leading-tight">Create your eMenu account.</h1><p className="mt-4 max-w-sm text-white/80">One secure ZenVentora identity, connected to your eMenu workspace.</p></div>
          <p className="text-xs text-white/65">Secure account creation · Existing menu data stays protected</p>
        </section>
        <section className="p-7 sm:p-10">
          <div className="mb-8"><p className="text-xs font-bold uppercase tracking-[.2em] text-teal-700">Get started</p><h2 className="mt-2 text-3xl font-black text-slate-900">Create your account</h2><p className="mt-2 text-sm text-slate-500">Sign up here to start setting up your eMenu.</p></div>
          {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {message && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
          <form onSubmit={submit} className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Full name</span><span className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-teal-600"><UserRound size={18} className="text-slate-400"/><input required maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" className="w-full bg-transparent text-sm outline-none"/></span></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Email address</span><span className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-teal-600"><Mail size={18} className="text-slate-400"/><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@company.com" className="w-full bg-transparent text-sm outline-none"/></span></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Phone number</span><span className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-teal-600"><Phone size={18} className="text-slate-400"/><input required type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Your phone number" className="w-full bg-transparent text-sm outline-none"/></span></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Create password</span><span className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-teal-600"><LockKeyhole size={18} className="text-slate-400"/><input required minLength={8} maxLength={128} autoComplete="new-password" type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" className="w-full bg-transparent text-sm outline-none"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} className="text-slate-400">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
            <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#10436f] to-[#0b9f9e] px-5 py-3.5 text-sm font-extrabold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60">{loading?'Creating account…':<>Create account <ArrowRight size={17}/></>}</button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link to="/login" className="font-bold text-teal-700 hover:underline">Sign in</Link></p>
          <p className="mt-7 text-center text-xs text-slate-400">Your credentials are securely handled by ZenVentora Common Accounts.</p>
        </section>
      </div>
    </main>
  )
}
