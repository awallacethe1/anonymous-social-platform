import { useState } from 'react';
import { patch } from '../api.js';
import { useApp } from '../state.jsx';
import { navigate } from '../router.jsx';
import { Button, Empty, ErrorNote, Spinner, UserRow, useLoad } from '../ui.jsx';
import { FollowButton } from '../components/Post.jsx';
import { INTERESTS } from '../../shared/constants.js';

export function InterestPicker({ value, onChange }) {
  const toggle = (i) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i]);
  return (
    <div className="chips" role="group" aria-label="Interests">
      {INTERESTS.map((i) => (
        <button key={i} type="button" className={value.includes(i) ? 'chip chip-on' : 'chip'} aria-pressed={value.includes(i)} onClick={() => toggle(i)}>{i}</button>
      ))}
    </div>
  );
}

/** First run after sign-up: choose interests, then find people. */
export default function Welcome() {
  const { me, setMe } = useApp();
  const [step, setStep] = useState(1);
  const [interests, setInterests] = useState(me.interests);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const suggestions = useLoad(step === 2 ? '/api/suggestions' : null);

  const saveInterests = async () => {
    setBusy(true); setError(null);
    try { setMe((await patch('/api/profile', { interests })).user); setStep(2); } catch (err) { setError(err); }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true); setError(null);
    try { setMe((await patch('/api/profile', { onboarded: true })).user); navigate('/', { replace: true }); }
    catch (err) { setError(err); setBusy(false); }
  };

  return (
    <main className="welcome" id="main">
      <h1 className="wordmark">ANONYMOUS</h1>
      <p className="muted" aria-live="polite">Step {step} of 2</p>
      {step === 1 ? (
        <section className="stack">
          <h2>What are you into, @{me.handle}?</h2>
          <p>Explore puts posts about these first. Pick at least three. You can change them any time in settings.</p>
          <InterestPicker value={interests} onChange={setInterests} />
          <ErrorNote error={error} />
          <div className="row">
            <Button variant="solid" busy={busy} disabled={interests.length < 3} onClick={saveInterests}>Continue</Button>
            {interests.length < 3 && <span className="muted">{3 - interests.length} more to go</span>}
          </div>
        </section>
      ) : (
        <section className="stack">
          <h2>Find people to follow</h2>
          <p>Their posts and reposts fill your Following page.</p>
          {suggestions.loading && <Spinner />}
          <ErrorNote error={suggestions.error} retry={suggestions.reload} />
          {suggestions.data?.items.length === 0 && <Empty title="Nobody else is here yet">Invite someone, or start by posting something yourself.</Empty>}
          <div className="user-list">
            {suggestions.data?.items.map((u) => <UserRow key={u.handle} user={u}><FollowButton user={u} /></UserRow>)}
          </div>
          <ErrorNote error={error} />
          <div className="row">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="solid" busy={busy} onClick={finish}>Go to Explore</Button>
          </div>
        </section>
      )}
    </main>
  );
}
