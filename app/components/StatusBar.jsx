'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter, usePathname } from 'next/navigation';

export default function StatusBar({ user }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  const goHome = () => { window.location.href = '/'; };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <nav className="top-nav" id="status-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Brand — hard navigate so it works even if the Next.js router is broken */}
        <button
          className="top-nav__brand"
          onClick={goHome}
          id="home-brand-btn"
          type="button"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-serif)' }}
        >
          News <span>Feed</span>
        </button>

        {/* Explicit ← Home shown only when authenticated and NOT on home page */}
        {user && pathname !== '/' && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={goHome}
            id="home-link-btn"
            type="button"
            title="Back to home"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', opacity: 0.7 }}
          >
            ← Home
          </button>
        )}
      </div>

      <div className="top-nav__right">
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button 
              className="btn btn-ghost" 
              onClick={() => { window.location.href = '/feed'; }}
              style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.95rem' }}
            >
              My Feed
            </button>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'var(--accent)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontFamily: 'var(--font-serif)',
              fontSize: '1.25rem', fontWeight: 700, color: '#fff'
            }}>
              {user?.user_metadata?.full_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <button className="btn btn-ghost" onClick={handleLogout} id="logout-btn" style={{ fontSize: '0.9rem' }}>
              Sign Out
            </button>
          </div>
        ) : (
          <span className="top-nav__meta">Not signed in</span>
        )}
      </div>
    </nav>
  );
}
