import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, QrCode } from 'lucide-react'
import { clsx } from 'clsx'

const navLinks = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Templates', href: '#templates' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

export default function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = (href: string) => {
    setMobileOpen(false)
    if (href.startsWith('#')) {
      const el = document.querySelector(href)
      el?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <header
      className={clsx(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100'
          : 'bg-transparent'
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-18">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-brand flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
              <QrCode className="w-4.5 h-4.5 text-white" size={18} />
            </div>
            <span className={clsx(
              'font-bold text-xl tracking-tight transition-colors',
              scrolled ? 'text-brand-blue' : 'text-white'
            )}>
              E-Menu
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <button
                key={link.label}
                onClick={() => scrollTo(link.href)}
                className={clsx(
                  'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors',
                  scrolled
                    ? 'text-gray-600 hover:text-brand-teal hover:bg-brand-teal/5'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                )}
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="hidden md:block">
            <a
              href="https://zenventora.in/emenu/signup.html"
              className={clsx(
                'px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md',
                scrolled
                  ? 'bg-brand-teal text-white hover:bg-brand-teal-dark'
                  : 'bg-white text-brand-blue hover:bg-white/90'
              )}
            >
              Get Started Free
            </a>
          </div>

          <button
            className={clsx(
              'md:hidden p-2 rounded-lg transition-colors',
              scrolled ? 'text-gray-700 hover:bg-gray-100' : 'text-white hover:bg-white/10'
            )}
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 shadow-lg">
          <div className="px-4 py-4 space-y-1">
            {navLinks.map((link) => (
              <button
                key={link.label}
                onClick={() => scrollTo(link.href)}
                className="w-full text-left px-4 py-3 rounded-xl text-gray-700 font-medium hover:text-brand-teal hover:bg-brand-teal/5 transition-colors"
              >
                {link.label}
              </button>
            ))}
            <div className="pt-3 border-t border-gray-100">
              <a
                href="https://zenventora.in/emenu/signup.html"
                onClick={() => setMobileOpen(false)}
                className="w-full py-3 rounded-xl bg-brand-teal text-white font-semibold text-center block"
              >
                Get Started Free
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
