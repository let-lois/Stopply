'use client';

// Top bar account menu: who you are signed in as, a light/dark toggle, the
// profile editor (change your name, change your password), and sign out.
// Works for both agency and tenant users; the profile endpoints resolve the
// right record from the session.

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { applyThemeMode, getThemeMode, type ThemeMode } from '@/lib/theme';
import { useToast } from './Toasts';

interface Profile {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<ThemeMode>('light');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMode(getThemeMode()), []);

  useEffect(() => {
    api<Profile>('/api/auth/profile').then(setProfile).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggleTheme = () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    applyThemeMode(next);
    setMode(next);
  };

  const initial = (profile?.name ?? '?').slice(0, 1).toUpperCase();

  return (
    <div className="acct-switcher" ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="small"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <span className="acct-avatar" style={{ width: 22, height: 22, fontSize: 12 }}>
          {initial}
        </span>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile?.name ?? 'Account'}
        </span>
      </button>

      {open && (
        <div className="profile-menu" role="menu">
          {profile && (
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--hairline)', marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{profile.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {profile.email}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setOpen(false);
            }}
          >
            Edit profile &amp; password
          </button>
          <button type="button" onClick={toggleTheme}>
            {mode === 'dark' ? '☀ Switch to light mode' : '🌙 Switch to dark mode'}
          </button>
          <button type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}

      {editing && (
        <ProfileEditor
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={(name) => setProfile((p) => (p ? { ...p, name } : p))}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(profile?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const saveName = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/profile', { method: 'PUT', json: { name: name.trim() } });
      onSaved(name.trim());
      toast('Profile updated');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        json: { currentPassword: current, newPassword: next },
      });
      setCurrent('');
      setNext('');
      toast('Password changed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'password change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card stack"
        style={{ width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Your profile</h3>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {profile && (
          <label>
            Email
            <input value={profile.email} disabled />
          </label>
        )}
        <button className="primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={saveName}>
          Save name
        </button>

        <hr style={{ width: '100%', border: 'none', borderTop: '1px solid var(--hairline)' }} />

        <h3 style={{ fontSize: 16 }}>Change password</h3>
        <label>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          New password (at least 8 characters)
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <button
          className="primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={busy || current.length < 1 || next.length < 8}
          onClick={savePassword}
        >
          Change password
        </button>

        {err && <p className="delta-down">{err}</p>}
      </div>
    </div>
  );
}
