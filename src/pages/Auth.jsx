import { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Button, Check, ErrorNote, Field, PasswordField } from '../ui.jsx';

function AuthShell({ title, lead, children }) {
  return (
    <main className="auth" id="main">
      <h1 className="wordmark">ANONYMOUS</h1>
      <p>Your corner of the internet.</p>
      <h2 className="auth-title">{title}</h2>
      {lead && <p className="muted">{lead}</p>}
      {children}
    </main>
  );
}

export function Login() {
  const { signIn } = useApp();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [ticket, setTicket] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const reply = await post('/api/auth/login', form);
      if (reply.twoFactor) setTicket(reply.ticket);
      else { signIn(reply); navigate('/', { replace: true }); }
    } catch (err) { setError(err); }
    setBusy(false);
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      signIn(await post('/api/auth/two-factor', { ticket, code }));
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
      if (err.data.restart) { setTicket(null); setCode(''); }
    }
    setBusy(false);
  };

  if (ticket) {
    return (
      <AuthShell title="Enter your code" lead="Open your authenticator app and type the 6-digit code for Anonymous.">
        <form className="stack" onSubmit={verify}>
          <Field hideLabel label="Code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
            hint="Lost your phone? Enter one of your recovery codes instead." error={error?.field === 'code' ? error.message : null} />
          {error && error.field !== 'code' && <ErrorNote error={error} />}
          <Button variant="solid" type="submit" busy={busy} disabled={!code.trim()}>Sign in</Button>
          <Button variant="link" onClick={() => { setTicket(null); setCode(''); setError(null); }}>Use a different account</Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Log in">
      <form className="stack" onSubmit={submit}>
        <Field hideLabel label="Username or email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required value={form.identifier} onChange={set('identifier')} />
        <PasswordField hideLabel autoComplete="current-password" required value={form.password} onChange={set('password')} />
        <ErrorNote error={error} />
        <Button variant="solid" type="submit" busy={busy}>Enter</Button>
      </form>
      <p className="auth-links">
        <Link to="/forgot">Forgot your password?</Link>
        <Link to="/signup">Create an Account</Link>
      </p>
    </AuthShell>
  );
}

/** A rough guide only; the server makes the real decision. */
function strength(password) {
  if (!password) return null;
  if (password.length < 10) return { level: 1, text: `${10 - password.length} more character${password.length === 9 ? '' : 's'} needed` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const score = password.length + kinds * 2;
  if (score < 16) return { level: 2, text: 'Acceptable. Longer is stronger.' };
  if (score < 22) return { level: 3, text: 'Good' };
  return { level: 4, text: 'Strong' };
}

export function Signup() {
  const { signIn } = useApp();
  const [form, setForm] = useState({ handle: '', email: '', password: '', ageConfirmed: false, acceptedGuidelines: false });
  const [availability, setAvailability] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const fieldError = (k) => (error?.field === k ? error.message : null);

  const handle = form.handle.trim().replace(/^@/, '').toLowerCase();
  useEffect(() => {
    setAvailability(null);
    if (handle.length < 3) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      get(`/api/auth/handle-available?handle=${encodeURIComponent(handle)}`).then((d) => { if (live) setAvailability(d); }, () => {});
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [handle]);

  const meter = strength(form.password);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      signIn(await post('/api/auth/signup', { ...form, handle }));
      navigate('/welcome', { replace: true });
    } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <AuthShell title="Create your account">
      <form className="stack" onSubmit={submit} noValidate>
        <Field
          hideLabel label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus maxLength={21} value={form.handle} onChange={set('handle')}
          error={fieldError('handle') || (availability && !availability.available ? availability.reason : null)}
          hint={availability?.available ? `@${handle} is available.` : '3–20 letters, numbers or underscores. This is public.'}
        />
        <Field hideLabel label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fieldError('email')}
          hint="Only used to recover your account. Never shown on your profile." />
        <div>
          <PasswordField hideLabel autoComplete="new-password" value={form.password} onChange={set('password')} error={fieldError('password')}
            hint={meter ? meter.text : 'At least 10 characters. A few unrelated words work well.'} />
          {meter && <div className={`meter meter-${meter.level}`} aria-hidden="true"><span /><span /><span /><span /></div>}
        </div>
        <div className="stack stack-tight">
          <Check checked={form.ageConfirmed} onChange={set('ageConfirmed')}>I am 13 or older.</Check>
          {fieldError('ageConfirmed') && <p className="field-error" role="alert">{fieldError('ageConfirmed')}</p>}
          <Check checked={form.acceptedGuidelines} onChange={set('acceptedGuidelines')}>
            I agree to the <Link to="/guidelines" target="_blank">community guidelines</Link>.
          </Check>
          {fieldError('acceptedGuidelines') && <p className="field-error" role="alert">{fieldError('acceptedGuidelines')}</p>}
        </div>
        {error && !error.field && <ErrorNote error={error} />}
        <Button variant="solid" type="submit" busy={busy}>Create Account</Button>
      </form>
      <p className="auth-links"><Link to="/login">Already have an account? Log In</Link></p>
    </AuthShell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await post('/api/auth/forgot', { email }); setSent(true); } catch (err) { setError(err); }
    setBusy(false);
  };
  if (sent) {
    return (
      <AuthShell title="Check your email">
        <p>If an account uses <strong>{email}</strong>, a link to choose a new password is on its way. The link works once and expires in 30 minutes.</p>
        <p className="auth-links"><Link to="/login">Back to sign in</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Reset your password" lead="Enter the email you signed up with and we will send you a link.">
      <form className="stack" onSubmit={submit}>
        <Field hideLabel label="Email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} error={error?.field === 'email' ? error.message : null} />
        {error && !error.field && <ErrorNote error={error} />}
        <Button variant="solid" type="submit" busy={busy}>Send reset link</Button>
      </form>
      <p className="auth-links"><Link to="/login">Back to sign in</Link></p>
    </AuthShell>
  );
}

export function Reset({ token }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meter = strength(password);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await post('/api/auth/reset', { token, password }); setDone(true); } catch (err) { setError(err); }
    setBusy(false);
  };
  if (done) {
    return (
      <AuthShell title="Password changed">
        <p>You have been signed out everywhere. Sign in with your new password.</p>
        <p className="auth-links"><Link to="/login">Sign in</Link></p>
      </AuthShell>
    );
  }
  if (!token || error?.data.expired) {
    return (
      <AuthShell title="This link has expired">
        <p>Reset links work once and last 30 minutes.</p>
        <p className="auth-links"><Link to="/forgot">Send a new link</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password">
      <form className="stack" onSubmit={submit}>
        <div>
          <PasswordField hideLabel label="New password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
            error={error?.field === 'password' ? error.message : null} hint={meter ? meter.text : 'At least 10 characters.'} />
          {meter && <div className={`meter meter-${meter.level}`} aria-hidden="true"><span /><span /><span /><span /></div>}
        </div>
        {error && !error.field && <ErrorNote error={error} />}
        <Button variant="solid" type="submit" busy={busy}>Change password</Button>
      </form>
    </AuthShell>
  );
}
