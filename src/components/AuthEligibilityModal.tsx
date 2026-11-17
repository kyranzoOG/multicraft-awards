import { useState } from 'react';
import { X, ShieldCheck, Mail, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import { getGoogleOAuthUrl, getSupabaseClient, isSupabaseConfigured, openGoogleOAuthPopup } from '../lib/supabase';
import type { VoterSessionState } from '../types/awards';

interface AuthEligibilityModalProps {
  open: boolean;
  onClose: () => void;
  voterSession: VoterSessionState;
  activeYearId: string | null;
  onSessionUpdated: () => Promise<void>;
}

export function AuthEligibilityModal({
  open,
  onClose,
  voterSession,
  activeYearId,
  onSessionUpdated,
}: AuthEligibilityModalProps) {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  if (!open) return null;

  const supabase = getSupabaseClient();
  const isSignedIn = Boolean(voterSession.voter);

  const syncServerIdentity = async () => {
    const client = getSupabaseClient();
    const session = (await client?.auth.getSession())?.data.session;
    if (session) {
      try {
        const res = await fetch('/api/auth/sync-identity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ yearId: activeYearId }),
        });
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to sync voter identity.');
        }
      } catch (err) {
        if (err instanceof Error && !err.message.includes('Failed to fetch')) {
          throw err;
        }
      }
    }
    await onSessionUpdated();
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setFallbackUrl(null);
    setBusy(true);
    try {
      const url = await getGoogleOAuthUrl();
      const result = await openGoogleOAuthPopup(url);
      if (result.blockedUrl) {
        setFallbackUrl(result.blockedUrl);
        setInfoMsg('Browser blocked the sign-in popup. Click "Open Google Sign-In Window" below to continue.');
        return;
      }
      await syncServerIdentity();
      setInfoMsg('Signed in with Google. Your email is verified.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setErrorMsg(null);
    setInfoMsg(null);
    const trimmedEmail = emailInput.trim().toLowerCase();
    if (!trimmedEmail || !passwordInput) {
      setErrorMsg('Please enter both your email address and password.');
      return;
    }

    setBusy(true);
    try {
      if (emailMode === 'signup') {
        const basePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
        const emailRedirectTo = `${window.location.origin}${basePath}/auth/callback`;
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: passwordInput,
          options: { emailRedirectTo },
        });
        if (error) throw error;
        if (data.session) {
          await syncServerIdentity();
          setInfoMsg('Account created and email verified.');
        } else {
          setInfoMsg(`Verification link sent to ${trimmedEmail}. Click the link in your inbox to verify your email.`);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: passwordInput,
        });
        if (error) throw error;
        await syncServerIdentity();
        setInfoMsg('Signed in successfully.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Email authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!supabase) return;
    const targetEmail = voterSession.voter?.google_email || emailInput.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Enter your email address to resend verification.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const basePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: targetEmail,
        options: {
          emailRedirectTo: `${window.location.origin}${basePath}/auth/callback`,
        },
      });
      if (error) throw error;
      setInfoMsg(`Verification email resent to ${targetEmail}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to resend verification email.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setBusy(true);
    await supabase.auth.signOut();
    await onSessionUpdated();
    setBusy(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--mc-backdrop)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Account Sign-In and Email Verification"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--mc-border-strong)] bg-[var(--mc-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--mc-border)] pb-4">
          <div>
            <p className="text-xs font-medium text-[var(--mc-accent)]">Account &amp; Email Verification</p>
            <h2 className="mt-1 font-display text-xl font-bold text-[var(--mc-ink)]">
              {isSignedIn ? 'Your Account' : 'Sign In to MultiCraft Awards'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isSupabaseConfigured ? (
          <div className="rounded-xl border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] p-4 text-sm text-[var(--mc-ink)]">
            <p className="font-semibold">Supabase Credentials Required</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--mc-ink-muted)]">
              Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Google and email authentication.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {errorMsg && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] p-3.5 text-sm text-[var(--mc-ink)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
                <span>{errorMsg}</span>
              </div>
            )}

            {infoMsg && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] p-3.5 text-sm text-[var(--mc-ink)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
                <span>{infoMsg}</span>
              </div>
            )}

            {!isSignedIn ? (
              <div className="space-y-5">
                {/* Primary Google Sign-In */}
                <div className="space-y-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGoogleSignIn}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--mc-accent)] px-4 text-sm font-semibold text-[var(--mc-accent-contrast)] transition-colors hover:bg-[var(--mc-accent-hover)] disabled:opacity-50"
                  >
                    {busy ? 'Opening Google Sign-In...' : 'Continue with Google'}
                  </button>

                  {fallbackUrl && (
                    <a
                      href={fallbackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] px-4 text-xs font-semibold text-[var(--mc-accent)]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Google Sign-In Window
                    </a>
                  )}
                </div>

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-[var(--mc-border)]" />
                  <span className="mx-3 shrink-0 text-xs text-[var(--mc-ink-muted)]">or use email</span>
                  <div className="flex-grow border-t border-[var(--mc-border)]" />
                </div>

                {/* Email & Password Sign In / Sign Up with Email Link Verification */}
                <form onSubmit={handleEmailAuth} className="space-y-3">
                  <div className="flex gap-2 rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-1 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setEmailMode('signin')}
                      className={`flex-1 rounded-md py-1.5 transition-colors ${
                        emailMode === 'signin'
                          ? 'bg-[var(--mc-surface)] text-[var(--mc-ink)]'
                          : 'text-[var(--mc-ink-muted)]'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailMode('signup')}
                      className={`flex-1 rounded-md py-1.5 transition-colors ${
                        emailMode === 'signup'
                          ? 'bg-[var(--mc-surface)] text-[var(--mc-ink)]'
                          : 'text-[var(--mc-ink-muted)]'
                      }`}
                    >
                      Create Account
                    </button>
                  </div>

                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="your.name@gmail.com"
                    className="h-10 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Password (min. 6 characters)"
                    className="h-10 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-4 text-sm font-semibold text-[var(--mc-ink)] transition-colors hover:border-[var(--mc-accent-border)] disabled:opacity-50"
                  >
                    <Mail className="h-4 w-4 text-[var(--mc-accent)]" />
                    {emailMode === 'signup' ? 'Sign Up & Send Verification Email' : 'Sign In with Email'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--mc-ink-muted)]">Signed in as</p>
                      <p className="truncate font-display text-base font-semibold text-[var(--mc-ink)]">
                        {voterSession.voter?.display_name}
                      </p>
                      {voterSession.voter?.google_email && (
                        <p className="truncate text-xs text-[var(--mc-ink-muted)]">
                          {voterSession.voter.google_email}
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${
                        voterSession.emailVerified ? 'text-[var(--mc-accent)]' : 'text-[var(--mc-ink-muted)]'
                      }`}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {voterSession.emailVerified ? 'Email Verified' : 'Verify Email'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--mc-ink-muted)]">
                    {voterSession.eligibilitySummary}
                  </p>
                </div>

                {!voterSession.emailVerified && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleResendVerification}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] px-4 text-xs font-semibold text-[var(--mc-accent)]"
                  >
                    <Mail className="h-4 w-4" />
                    Resend Verification Email
                  </button>
                )}

                <div className="flex items-center justify-between border-t border-[var(--mc-border)] pt-4">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={busy}
                    className="text-xs font-medium text-[var(--mc-ink-muted)] underline-offset-4 hover:text-[var(--mc-ink)] hover:underline"
                  >
                    Sign Out
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 rounded-lg border border-[var(--mc-border-strong)] px-4 text-xs font-semibold text-[var(--mc-ink)]"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
