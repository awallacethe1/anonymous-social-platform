import { useEffect, useRef, useState } from 'react';
import { get, post as send, patch, del } from '../api.js';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Avatar, Button, Check, Confirm, Empty, ErrorNote, Field, Modal, PasswordField, Spinner, Time, UserRow, useLoad } from '../ui.jsx';
import { InterestPicker } from './Welcome.jsx';
import { uploadImage } from '../images.js';
import { LIMITS } from '../../shared/constants.js';
import { BackgroundPicker, backgroundStyle } from '../background.jsx';

const SECTIONS = [['profile', 'Profile'], ['privacy', 'Privacy and safety'], ['security', 'Sign-in and security'], ['account', 'Account']];

/** Wraps an async action with busy and error state. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); setBusy(false); return true; } catch (err) { setError(err); setBusy(false); return false; }
  };
  return { busy, error, run, fieldError: (k) => (error?.field === k ? error.message : null), general: error && !error.field ? error : null };
}

function ProfileSettings() {
  const { me, setMe, toast } = useApp();
  const [form, setForm] = useState({
    displayName: me.displayName, bio: me.bio, background: me.background, appBackground: me.appBackground, avatar: me.avatar,
    musicUrl: me.music?.url || '', interests: me.interests,
  });
  // Preview the unsaved app canvas while editing; restore the saved canvas on exit.
  useEffect(() => {
    const body = document.body.style;
    const original = {
      background: body.background,
      backgroundImage: body.backgroundImage,
      backgroundSize: body.backgroundSize,
      backgroundPosition: body.backgroundPosition,
      backgroundRepeat: body.backgroundRepeat,
      backgroundAttachment: body.backgroundAttachment,
    };
    const style = backgroundStyle(form.appBackground);
    body.background = '';
    body.backgroundImage = '';
    body.backgroundSize = '';
    body.backgroundPosition = '';
    body.backgroundRepeat = '';
    body.backgroundAttachment = '';
    if (style) Object.assign(body, style, { backgroundAttachment: 'fixed' });
    document.body.classList.toggle('has-app-background', !!form.appBackground);
    return () => {
      Object.assign(body, original);
      document.body.classList.toggle('has-app-background', !!me.appBackground);
    };
  }, [form.appBackground, me.appBackground]);
  const [uploading, setUploading] = useState(null);
  const action = useAction();
  const avatarRef = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const pick = async (key, file, options) => {
    if (!file) return;
    setUploading(key);
    try { const url = await uploadImage(file, options); setForm((f) => ({ ...f, [key]: url })); }
    catch (err) { toast(err.message, 'error'); }
    setUploading(null);
  };

  const save = (e) => {
    e.preventDefault();
    action.run(async () => { setMe((await patch('/api/profile', form)).user); toast('Profile saved.'); });
  };

  return (
    <form className="stack" onSubmit={save}>
      <div className="setting">
        <h2>Photo</h2>
        <div className="row">
          <Avatar user={{ ...me, avatar: form.avatar }} size="xl" />
          <input ref={avatarRef} className="sr-only" id="avatar-file" type="file" accept="image/*" onChange={(e) => pick('avatar', e.target.files?.[0], { max: 480, square: true })} />
          <label htmlFor="avatar-file" className="btn btn-plain btn-small">{uploading === 'avatar' ? 'Uploading…' : 'Choose photo'}</label>
          {form.avatar && <Button variant="link" className="btn-small" onClick={() => setForm({ ...form, avatar: null })}>Remove</Button>}
        </div>
      </div>

      <Field label="Name" maxLength={LIMITS.displayName} value={form.displayName} onChange={set('displayName')} error={action.fieldError('displayName')} />
      <Field as="textarea" label="Bio" rows={3} maxLength={LIMITS.bio} value={form.bio} onChange={set('bio')} hint={`${form.bio.length}/${LIMITS.bio}`} error={action.fieldError('bio')} />

      <BackgroundPicker legend="Profile background" hint="Shown across the top of your profile to everyone who visits."
        value={form.background} onChange={(background) => setForm((f) => ({ ...f, background }))} defaultLabel="Default (dark)" defaultColor="#222222" />

      <BackgroundPicker legend="App background" hint="Your personal canvas across the app. Preview changes immediately, then save to keep them. Only you see this."
        value={form.appBackground} onChange={(appBackground) => setForm((f) => ({ ...f, appBackground }))} defaultLabel="Default (white)" defaultColor="#ffffff" />

      <Field label="Profile music" type="url" inputMode="url" placeholder="https://open.spotify.com/track/…" value={form.musicUrl} onChange={set('musicUrl')} error={action.fieldError('musicUrl')}
        hint="Paste a link to a track, album or playlist on Spotify, Apple Music, SoundCloud or YouTube. Visitors press play to hear it in that service's own player." />

      <fieldset className="setting">
        <legend>Interests</legend>
        <p className="muted small">Explore puts posts about these first.</p>
        <InterestPicker value={form.interests} onChange={(interests) => setForm({ ...form, interests })} />
      </fieldset>

      <ErrorNote error={action.general} />
      <div className="row">
        <Button variant="solid" type="submit" busy={action.busy} disabled={!!uploading}>Save profile</Button>
        <Link to={`/u/${me.handle}`}>View profile</Link>
      </div>
    </form>
  );
}

function PrivacySettings() {
  const { me, setMe, toast } = useApp();
  const blocks = useLoad('/api/blocks');
  const change = async (body) => {
    try { setMe((await patch('/api/profile', body)).user); toast('Saved.'); } catch (err) { toast(err.message, 'error'); }
  };
  const unblock = async (handle) => {
    try { await del(`/api/users/${handle}/block`); blocks.reload(); toast(`@${handle} is unblocked.`); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="stack">
      <fieldset className="setting choices">
        <legend>Who can message you</legend>
        {[['everyone', 'Everyone'], ['following', 'Only people I follow'], ['none', 'No one']].map(([key, label]) => (
          <label key={key} className="choice"><input type="radio" name="dm" checked={me.dmPolicy === key} onChange={() => change({ dmPolicy: key })} /><span>{label}</span></label>
        ))}
      </fieldset>

      <div className="setting">
        <h2>Anonymous questions</h2>
        <Check checked={me.allowQuestions} onChange={(e) => change({ allowQuestions: e.target.checked })}>Let people send me anonymous questions</Check>
        <p className="muted small">You never see who asked. You can delete a question, stop further questions from its sender, or report it. Nothing is public until you answer.</p>
      </div>

      <div className="setting">
        <h2>Blocked accounts</h2>
        {blocks.loading && <Spinner />}
        <ErrorNote error={blocks.error} retry={blocks.reload} />
        {blocks.data?.items.length === 0 && <p className="muted">You have not blocked anyone. You can block someone from their profile or from any of their posts.</p>}
        <div className="user-list">
          {blocks.data?.items.map((u) => <UserRow key={u.handle} user={u} link={false}><Button className="btn-small" onClick={() => unblock(u.handle)}>Unblock</Button></UserRow>)}
        </div>
      </div>
      <p className="muted small">Read the <Link to="/guidelines">community guidelines</Link> for what is and is not allowed here.</p>
    </div>
  );
}

function PasswordForm() {
  const { toast } = useApp();
  const [form, setForm] = useState({ current: '', next: '' });
  const action = useAction();
  const submit = async (e) => {
    e.preventDefault();
    if (await action.run(() => send('/api/account/password', form))) { setForm({ current: '', next: '' }); toast('Password changed. Other devices were signed out.'); }
  };
  return (
    <form className="setting stack stack-tight" onSubmit={submit}>
      <h2>Password</h2>
      <PasswordField label="Current password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} error={action.fieldError('password')} />
      <PasswordField label="New password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} error={action.fieldError('next')} hint="At least 10 characters." />
      <ErrorNote error={action.general} />
      <div><Button variant="solid" type="submit" busy={action.busy} disabled={!form.current || !form.next}>Change password</Button></div>
    </form>
  );
}

function TwoStep() {
  const { me, setMe, toast } = useApp();
  const [stage, setStage] = useState(null); // 'password' | 'scan' | 'codes' | 'off'
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState([]);
  const action = useAction();
  const close = () => { setStage(null); setPassword(''); setCode(''); setSetup(null); };

  const begin = (e) => { e.preventDefault(); action.run(async () => { setSetup(await send('/api/account/two-factor/setup', { password })); setPassword(''); setStage('scan'); }); };
  const enable = (e) => { e.preventDefault(); action.run(async () => { const d = await send('/api/account/two-factor/enable', { code }); setCodes(d.recoveryCodes); setMe({ ...me, twoFactor: true }); setStage('codes'); }); };
  const disable = (e) => { e.preventDefault(); action.run(async () => { await send('/api/account/two-factor/disable', { password }); setMe({ ...me, twoFactor: false }); toast('Two-step sign-in is off.'); close(); }); };
  const copy = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Recovery codes copied.'); } catch { toast('Could not copy. Write them down instead.', 'error'); } };

  return (
    <div className="setting">
      <h2>Two-step sign-in</h2>
      <p>{me.twoFactor ? 'On. Signing in needs your password and a code from your authenticator app.' : 'Off. Add a second step so a stolen password is not enough to get into your account.'}</p>
      {me.twoFactor ? <Button onClick={() => setStage('off')}>Turn off</Button> : <Button variant="solid" onClick={() => setStage('password')}>Set up two-step sign-in</Button>}

      {stage === 'password' && (
        <Modal title="Confirm your password" onClose={close}>
          <form className="stack" onSubmit={begin}>
            <PasswordField autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={action.fieldError('password')} />
            <ErrorNote error={action.general} />
            <div className="row row-end"><Button onClick={close}>Cancel</Button><Button variant="solid" type="submit" busy={action.busy} disabled={!password}>Continue</Button></div>
          </form>
        </Modal>
      )}
      {stage === 'scan' && setup && (
        <Modal title="Add Anonymous to your authenticator app" onClose={close}>
          <form className="stack" onSubmit={enable}>
            <p>In an authenticator app (such as Google Authenticator, 1Password or Authy), add a new account and enter this setup key:</p>
            <p className="secret" aria-label="Setup key">{setup.secret.match(/.{1,4}/g).join(' ')}</p>
            <p className="small"><a href={setup.uri}>Open in an authenticator app on this device</a></p>
            <Field label="6-digit code from the app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} error={action.fieldError('code')} autoFocus />
            <ErrorNote error={action.general} />
            <div className="row row-end"><Button onClick={close}>Cancel</Button><Button variant="solid" type="submit" busy={action.busy} disabled={code.trim().length < 6}>Turn on</Button></div>
          </form>
        </Modal>
      )}
      {stage === 'codes' && (
        <Modal title="Save your recovery codes" onClose={close}>
          <div className="stack">
            <p>Two-step sign-in is on. If you lose your phone, each of these codes will sign you in once. They are shown only now, so keep them somewhere safe.</p>
            <ul className="codes plain-list">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="row row-end"><Button onClick={copy}>Copy codes</Button><Button variant="solid" onClick={close}>I have saved them</Button></div>
          </div>
        </Modal>
      )}
      {stage === 'off' && (
        <Modal title="Turn off two-step sign-in" onClose={close}>
          <form className="stack" onSubmit={disable}>
            <p>Your account will be protected by your password alone.</p>
            <PasswordField autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={action.fieldError('password')} />
            <ErrorNote error={action.general} />
            <div className="row row-end"><Button onClick={close}>Cancel</Button><Button variant="danger" type="submit" busy={action.busy} disabled={!password}>Turn off</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function describeDevice(ua) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function Sessions() {
  const { toast } = useApp();
  const { data, error, loading, reload } = useLoad('/api/account/sessions');
  const end = async (id) => { try { await del(`/api/account/sessions/${id}`); reload(); } catch (err) { toast(err.message, 'error'); } };
  const endOthers = async () => { try { await send('/api/account/sessions/end-others'); reload(); toast('Signed out everywhere else.'); } catch (err) { toast(err.message, 'error'); } };
  return (
    <div className="setting">
      <h2>Where you are signed in</h2>
      {loading && !data && <Spinner />}
      <ErrorNote error={error} retry={reload} />
      <ul className="plain-list sessions">
        {data?.items.map((s) => (
          <li key={s.id} className="row row-between">
            <span>
              <strong>{describeDevice(s.userAgent)}</strong>{s.current && <span className="badge">This device</span>}<br />
              <span className="muted small">{s.ip}, last active <Time at={s.lastSeenAt} /></span>
            </span>
            {!s.current && <Button className="btn-small" onClick={() => end(s.id)}>Sign out</Button>}
          </li>
        ))}
      </ul>
      {data?.items.length > 1 && <Button onClick={endOthers}>Sign out everywhere else</Button>}
    </div>
  );
}

function AccountSettings() {
  const { me, setMe, signIn, toast } = useApp();
  const [email, setEmail] = useState({ email: me.email, password: '' });
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const emailAction = useAction();
  const deleteAction = useAction();

  const saveEmail = async (e) => {
    e.preventDefault();
    if (await emailAction.run(async () => { const d = await send('/api/account/email', email); setMe({ ...me, email: d.email }); })) { setEmail((x) => ({ ...x, password: '' })); toast('Email changed.'); }
  };
  const download = async () => {
    try {
      const data = await get('/api/account/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `anonymous-${me.handle}.json` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast(err.message, 'error'); }
  };
  const signOut = async () => { try { await send('/api/auth/logout'); } finally { signIn(null); navigate('/login', { replace: true }); } };
  const remove = (e) => {
    e.preventDefault();
    deleteAction.run(async () => { await send('/api/account/delete', { password }); signIn(null); navigate('/login', { replace: true }); });
  };

  return (
    <div className="stack">
      <form className="setting stack stack-tight" onSubmit={saveEmail}>
        <h2>Email</h2>
        <Field label="Email address" type="email" autoComplete="email" value={email.email} onChange={(e) => setEmail({ ...email, email: e.target.value })} error={emailAction.fieldError('email')} hint="Used only to recover your account." />
        {email.email.trim().toLowerCase() !== me.email && (
          <>
            <PasswordField label="Your password, to confirm" autoComplete="current-password" value={email.password} onChange={(e) => setEmail({ ...email, password: e.target.value })} error={emailAction.fieldError('password')} />
            <ErrorNote error={emailAction.general} />
            <div><Button variant="solid" type="submit" busy={emailAction.busy} disabled={!email.password}>Change email</Button></div>
          </>
        )}
      </form>
      <div className="setting">
        <h2>Your data</h2>
        <p>Download everything you have posted, saved and sent as a JSON file.</p>
        <Button onClick={download}>Download my data</Button>
      </div>
      <div className="setting">
        <h2>Sign out</h2>
        <Button onClick={signOut}>Sign out of @{me.handle}</Button>
      </div>
      <div className="setting">
        <h2>Delete account</h2>
        <p>Permanently removes your profile, posts, comments, boards, messages and images. This cannot be undone.</p>
        <Button variant="danger" onClick={() => setDeleting(true)}>Delete my account</Button>
      </div>
      {deleting && (
        <Modal title="Delete your account?" onClose={() => setDeleting(false)}>
          <form className="stack" onSubmit={remove}>
            <p>Everything belonging to @{me.handle} will be deleted straight away. Enter your password to confirm.</p>
            <PasswordField autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={deleteAction.fieldError('password')} />
            <ErrorNote error={deleteAction.general} />
            <div className="row row-end"><Button onClick={() => setDeleting(false)}>Cancel</Button><Button variant="danger" type="submit" busy={deleteAction.busy} disabled={!password}>Delete account</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function Settings({ section }) {
  const { me } = useApp();
  const current = SECTIONS.some(([k]) => k === section) ? section : 'profile';
  return (
    <section className="settings">
      <header className="page-head"><h2 className="page-title">Settings</h2></header>
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map(([key, label]) => <Link key={key} to={key === 'profile' ? '/settings' : `/settings/${key}`} className={current === key ? 'tab tab-active' : 'tab'} aria-current={current === key ? 'page' : undefined}>{label}</Link>)}
        {me.role === 'admin' && <Link to="/moderation" className="tab">Moderation</Link>}
      </nav>
      <div className="settings-body">
        {current === 'profile' && <ProfileSettings />}
        {current === 'privacy' && <PrivacySettings />}
        {current === 'security' && <div className="stack"><PasswordForm /><TwoStep /><Sessions /></div>}
        {current === 'account' && <AccountSettings />}
      </div>
    </section>
  );
}

export function Moderation() {
  const { me, toast } = useApp();
  const [status, setStatus] = useState('open');
  const reports = useLoad(me.role === 'admin' ? `/api/admin/reports?status=${status}` : null);
  const suspended = useLoad(me.role === 'admin' ? '/api/admin/suspended' : null);
  const [confirm, setConfirm] = useState(null);

  if (me.role !== 'admin') return <Empty title="Page not found"><Link to="/">Back to Explore</Link></Empty>;

  const resolve = async (id, action) => {
    await send(`/api/admin/reports/${id}/resolve`, { action });
    toast('Report closed.');
    reports.reload(); suspended.reload();
  };
  const reinstate = async (handle) => { try { await send(`/api/admin/users/${handle}/reinstate`); suspended.reload(); toast(`@${handle} is reinstated.`); } catch (err) { toast(err.message, 'error'); } };
  const labels = { dismiss: 'No action taken', remove: 'Content removed', suspend: 'Account suspended' };

  return (
    <section>
      <header className="page-head"><h2 className="page-title">Moderation</h2></header>
      <div className="tabs" role="tablist" aria-label="Report status">
        {[['open', 'Open reports'], ['resolved', 'Closed']].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={status === k} className={status === k ? 'tab tab-active' : 'tab'} onClick={() => setStatus(k)}>{label}</button>)}
      </div>
      {reports.loading && !reports.data && <Spinner />}
      <ErrorNote error={reports.error} retry={reports.reload} />
      {reports.data?.items.length === 0 && <Empty title={status === 'open' ? 'No open reports' : 'No closed reports'} />}
      {reports.data?.items.map((r) => (
        <article key={r.id} className="post report">
          <p className="muted small">
            {r.targetType} reported for <strong>{r.reason}</strong> by {r.reporter ? `@${r.reporter}` : 'a deleted account'}, <Time at={r.createdAt} />
          </p>
          {r.account && <p>Account responsible: <Link to={`/u/${r.account.handle}`}>@{r.account.handle}</Link>{r.account.suspended && <span className="badge">Suspended</span>}{r.targetType === 'question' && <span className="muted small"> (anonymous to the recipient)</span>}</p>}
          {r.content ? <blockquote className="asked">{r.content.body || '(no text)'}{r.content.removed && <span className="badge">Removed</span>}</blockquote> : <p className="muted">The reported content no longer exists.</p>}
          {r.content?.image && <img className="report-image" src={r.content.image} alt="Reported image" />}
          {r.details && <p><span className="muted">Reporter’s note:</span> {r.details}</p>}
          {r.status === 'open' ? (
            <div className="row">
              <Button className="btn-small" onClick={() => resolve(r.id, 'dismiss').catch((e) => toast(e.message, 'error'))}>Dismiss</Button>
              {r.targetType !== 'user' && <Button className="btn-small" onClick={() => setConfirm({ id: r.id, action: 'remove' })}>Remove content</Button>}
              {r.account && !r.account.isAdmin && <Button variant="danger" className="btn-small" onClick={() => setConfirm({ id: r.id, action: 'suspend', handle: r.account.handle })}>Suspend account</Button>}
            </div>
          ) : <p className="muted small">{labels[r.resolution] || r.resolution}</p>}
        </article>
      ))}
      {suspended.data?.items.length > 0 && (
        <section className="panel">
          <h2>Suspended accounts</h2>
          <div className="user-list">{suspended.data.items.map((u) => <UserRow key={u.handle} user={u} link={false}><Button className="btn-small" onClick={() => reinstate(u.handle)}>Reinstate</Button></UserRow>)}</div>
        </section>
      )}
      {confirm && (
        <Confirm title={confirm.action === 'suspend' ? `Suspend @${confirm.handle}?` : 'Remove this content?'} action={confirm.action === 'suspend' ? 'Suspend account' : 'Remove content'} danger
          onClose={() => setConfirm(null)} onConfirm={() => resolve(confirm.id, confirm.action)}>
          <p>{confirm.action === 'suspend' ? 'They are signed out everywhere, cannot sign in, and their profile and posts are hidden. The reported content is removed.' : 'It is hidden from everyone. The account stays active.'}</p>
        </Confirm>
      )}
    </section>
  );
}
