'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import StatusBar from '../components/StatusBar';

const INTEREST_OPTIONS = [
  'Cricket', 'Fashion', 'Health', 'Fitness',
  'Entertainment', 'Politics', 'Tech', 'Lifestyle',
  'Science', 'Travel', 'Comedy', 'Art',
  'News', 'Music', 'Finance', 'Sports',
  'AI & ML', 'Gaming', 'Food', 'Business',
  'Nifty 50', 'Indian Economics', 'Bollywood', 'Environment',
];

const MAX_TOPICS = 5;

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
];

const COUNTRIES = [
  { code: '', name: 'International (All)' },
  { code: 'in', name: 'India' },
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'au', name: 'Australia' },
  { code: 'ca', name: 'Canada' },
  { code: 'sg', name: 'Singapore' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'jp', name: 'Japan' },
  { code: 'cn', name: 'China' },
  { code: 'pk', name: 'Pakistan' },
  { code: 'bd', name: 'Bangladesh' },
];

export default function SetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const customRef = useRef(null);

  const [user, setUser] = useState(null);
  const [selected, setSelected] = useState([]);
  const [customInterests, setCustomInterests] = useState([]); // all custom interests ever added
  const [lang, setLang] = useState('en');
  const [country, setCountry] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('interests, lang, country')
        .eq('id', user.id)
        .single();

      if (profile?.interests) {
        const interests = profile.interests;
        // Load selected interests (topic_* keys only)
        const sel = [...new Set(
          Object.entries(interests)
            .filter(([k]) => k.startsWith('topic_'))
            .map(([, v]) => v)
            .filter(Boolean)
        )];
        // Load custom interests — exclude any that are already predefined
        const rawCustom = Array.isArray(interests.__custom) ? interests.__custom : [];
        const custom = [...new Set(rawCustom.filter(c => !INTEREST_OPTIONS.includes(c)))];
        setSelected(sel);
        setCustomInterests(custom);
      }
      if (profile?.lang) setLang(profile.lang);
      if (profile?.country) setCountry(profile.country);
      setLoaded(true);
    }
    loadProfile();
  }, []);

  const toggleInterest = (interest) => {
    setSelected((prev) => {
      if (prev.includes(interest)) return prev.filter((i) => i !== interest);
      if (prev.length >= MAX_TOPICS) return prev; // hard cap
      return [...prev, interest];
    });
  };

  const removeCustomInterest = async (custom) => {
    const newCustom = customInterests.filter(c => c !== custom);
    const newSelected = selected.filter(s => s !== custom);
    setCustomInterests(newCustom);
    setSelected(newSelected);
    // Persist removal immediately
    if (user) {
      const interestsObj = {};
      newSelected.forEach((s, i) => { interestsObj[`topic_${i}`] = s; });
      interestsObj.__custom = newCustom;
      await supabase.from('profiles').upsert({ id: user.id, email: user.email, interests: interestsObj }, { onConflict: 'id' });
    }
  };

  const addCustom = async () => {
    const trimmed = customValue.trim();
    if (!trimmed) return;
    if (selected.length >= MAX_TOPICS && !selected.includes(trimmed)) {
      setCustomValue('');
      setShowCustomInput(false);
      return; // silently block — UI already shows the cap
    }
    // Prevent duplicates — both with existing custom AND predefined interests
    if (customInterests.includes(trimmed) || selected.includes(trimmed)) return;
    // Don't allow adding predefined interests as custom
    if (INTEREST_OPTIONS.includes(trimmed)) {
      if (!selected.includes(trimmed)) setSelected(prev => [...prev, trimmed]);
      setCustomValue('');
      setShowCustomInput(false);
      return;
    }

    const newSelected = [...selected, trimmed];
    const newCustom = [...customInterests, trimmed];
    setSelected(newSelected);
    setCustomInterests(newCustom);
    setCustomValue('');
    setShowCustomInput(false);

    // Auto-save immediately so it persists even if user navigates away
    if (user) {
      const interestsObj = {};
      newSelected.forEach((s, i) => { interestsObj[`topic_${i}`] = s; });
      interestsObj.__custom = newCustom; // always persist all custom interests
      await supabase.from('profiles').upsert({ id: user.id, email: user.email, interests: interestsObj }, { onConflict: 'id' });
    }
  };

  const handleSave = async () => {
    if (!user) {
      alert('Not logged in — please refresh the page');
      return;
    }
    if (selected.length === 0) {
      alert('Please select at least one interest');
      return;
    }

    setSaving(true);
    setSaveProgress(0);

    const interval = setInterval(() => {
      setSaveProgress((p) => {
        if (p >= 90) { clearInterval(interval); return 90; }
        return p + Math.random() * 20;
      });
    }, 150);

    try {
      const interestsObj = {};
      selected.forEach((s, i) => { interestsObj[`topic_${i}`] = s; });
      interestsObj.__custom = customInterests; // always persist custom interests even if deselected

      console.log('[Setup] Saving profile:', { userId: user.id, interests: interestsObj, lang, country });

      const { error, data } = await supabase
        .from('profiles')
        .upsert({ id: user.id, email: user.email, interests: interestsObj, lang, country }, { onConflict: 'id' });

      console.log('[Setup] Supabase result:', { error, data });

      clearInterval(interval);
      if (error) throw error;

      setSaveProgress(100);
      setTimeout(() => router.push('/feed'), 800);
    } catch (err) {
      console.error('[Setup] Save error:', err);
      clearInterval(interval);
      setSaving(false);
      setSaveProgress(0);
      alert(`Save failed: ${err.message || JSON.stringify(err)}`);
    }
  };

  if (!loaded) {
    return (
      <div className="app-container">
        <StatusBar user={user} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="text-muted">Loading<span className="loading-dots" /></span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <StatusBar user={user} />

      <div className="setup-page">
        <h1 className="setup-page__title">What interests you?</h1>
        <p className="setup-page__subtitle">
          Select topics, language, and scope. Our AI uses these to curate
          and explain why each article matters to you.
        </p>

        {/* Language & Scope */}
        <div className="section-label">
          <span className="section-label__line" />
          <span className="section-label__text">Language & Scope</span>
          <span className="section-label__line" />
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="small-caps" style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--fg-muted)' }}>
              News Language
            </label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="custom-input-row__field"
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '4px', cursor: 'pointer' }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="small-caps" style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--fg-muted)' }}>
              Scope
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="custom-input-row__field"
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '4px', cursor: 'pointer' }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Topics */}
        <div className="section-label">
          <span className="section-label__line" />
          <span className="section-label__text">Select Your Topics</span>
          <span className="section-label__line" />
        </div>

        {/* Counter + limit hint */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '1rem',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
            color: selected.length >= MAX_TOPICS ? 'var(--accent)' : 'var(--fg-muted)',
            letterSpacing: '0.07em', textTransform: 'uppercase',
            fontWeight: selected.length >= MAX_TOPICS ? 700 : 400,
          }}>
            {selected.length} / {MAX_TOPICS} topics selected
          </span>
          {selected.length >= MAX_TOPICS && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
              color: 'var(--fg-muted)', letterSpacing: '0.05em',
            }}>
              Remove one to add another
            </span>
          )}
        </div>

        <div className="interest-grid">
          {INTEREST_OPTIONS.map((interest) => {
            const isActive = selected.includes(interest);
            const isDisabled = !isActive && selected.length >= MAX_TOPICS;
            return (
              <button
                key={interest}
                className={`interest-pill ${isActive ? 'interest-pill--active' : ''}`}
                onClick={() => toggleInterest(interest)}
                aria-pressed={isActive}
                type="button"
                disabled={isDisabled}
                id={`interest-${interest.toLowerCase().replace(/[^a-z]/g, '')}`}
                style={isDisabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
              >
                <span className="interest-pill__check">{isActive ? '✕' : '○'}</span>
                {interest}
              </button>
            );
          })}

          {customInterests
            .filter(c => !INTEREST_OPTIONS.includes(c))
            .map((custom) => {
            const isActive = selected.includes(custom);
            return (
              <div key={custom} style={{ position: 'relative', display: 'inline-flex' }}>
                <button
                  className={`interest-pill ${isActive ? 'interest-pill--active' : ''}`}
                  onClick={() => toggleInterest(custom)}
                  aria-pressed={isActive}
                  type="button"
                  style={{ paddingRight: '2rem' }}
                >
                  <span className="interest-pill__check">{isActive ? '✕' : '○'}</span>
                  {custom}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeCustomInterest(custom); }}
                  type="button"
                  title="Remove permanently"
                  style={{
                    position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--fg-muted)', fontSize: '0.7rem', lineHeight: 1, padding: '2px',
                    opacity: 0.6,
                  }}
                >
                  🗑
                </button>
              </div>
            );
          })}

          {!showCustomInput && (
            <button
              className="interest-pill interest-pill--custom"
              onClick={() => {
                setShowCustomInput(true);
                setTimeout(() => customRef.current?.focus(), 50);
              }}
              type="button"
            >
              <span style={{ fontSize: '0.8rem' }}>+</span>
              Add Custom
            </button>
          )}
        </div>

        {showCustomInput && (
          <div className="custom-input-row">
            <span className="small-caps" style={{ flexShrink: 0 }}>Custom →</span>
            <input
              ref={customRef}
              type="text"
              className="custom-input-row__field"
              placeholder="e.g., Quantum Computing, IPL 2026…"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCustom();
                if (e.key === 'Escape') { setShowCustomInput(false); setCustomValue(''); }
              }}
              maxLength={40}
            />
            <button className="btn btn-primary btn-sm" onClick={addCustom} type="button">Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowCustomInput(false); setCustomValue(''); }} type="button">Cancel</button>
          </div>
        )}

        {saving && (
          <div className="setup-progress">
            <div className="setup-progress__fill" style={{ width: `${saveProgress}%` }} />
          </div>
        )}

        <div className="setup-actions">
          <div className="setup-count">
            <strong>{selected.length}</strong>/{MAX_TOPICS} topic{selected.length !== 1 ? 's' : ''} selected
            {lang !== 'en' && <> · {LANGUAGES.find(l => l.code === lang)?.name}</>}
            {country && <> · {COUNTRIES.find(c => c.code === country)?.name}</>}
          </div>
          <div className="flex-row gap-2">
            <button className="btn btn-ghost" onClick={() => router.push('/feed')} disabled={saving} type="button">
              Skip for now
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || selected.length === 0} type="button">
              {saving ? `Saving… ${Math.round(saveProgress)}%` : 'Save & Continue →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
