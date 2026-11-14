import { useState } from 'react';
import { post as send, del } from '../api.js';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Avatar, Button, Confirm, Empty, ErrorNote, LoadMore, Menu, Spinner, Tabs, Time, useLoad, usePaged } from '../ui.jsx';
import { AnswerCard, AskDialog, PersonPicker, ReportDialog } from '../components/Post.jsx';
import { LIMITS } from '../../shared/constants.js';

function InboxQuestion({ question, onGone }) {
  const { toast, refreshCounts } = useApp();
  const [answer, setAnswer] = useState('');
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const gone = () => { onGone(question.id); refreshCounts(); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await send(`/api/questions/${question.id}/answer`, { body: answer }); toast('Answered. It now shows on your profile.'); gone(); }
    catch (err) { setError(err); setBusy(false); }
  };

  return (
    <article className="post question">
      <header className="post-head">
        <span className="muted">Anonymous asked</span>
        <span className="muted post-time"><Time at={question.createdAt} /></span>
        <Menu label="Question options" items={[
          { label: 'Delete question', onSelect: () => setDialog('delete') },
          { label: 'Stop questions from this sender', onSelect: () => setDialog('silence') },
          { label: 'Report question', danger: true, onSelect: () => setDialog('report') },
        ]} />
      </header>
      <blockquote className="asked">{question.body}</blockquote>
      {!open ? <Button className="btn-small" onClick={() => setOpen(true)}>Answer</Button> : (
        <form className="stack stack-tight" onSubmit={submit}>
          <label className="sr-only" htmlFor={`answer-${question.id}`}>Your answer</label>
          <textarea id={`answer-${question.id}`} rows={3} maxLength={LIMITS.answer} placeholder="Your answer will be public." value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
          <ErrorNote error={error} />
          <div className="row row-end">
            <Button className="btn-small" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="solid" className="btn-small" type="submit" busy={busy} disabled={!answer.trim()}>Publish answer</Button>
          </div>
        </form>
      )}
      {dialog === 'delete' && (
        <Confirm title="Delete this question?" action="Delete" danger onClose={() => setDialog(null)} onConfirm={async () => { await del(`/api/questions/${question.id}`); gone(); }}>
          <p>It will be removed without being answered. The sender is not told.</p>
        </Confirm>
      )}
      {dialog === 'silence' && (
        <Confirm title="Stop questions from this sender?" action="Stop their questions" danger onClose={() => setDialog(null)}
          onConfirm={async () => { await send(`/api/questions/${question.id}/silence`); toast('You will not receive questions from that sender again.'); gone(); }}>
          <p>This question is deleted and anything else this person sends you is discarded. You will not find out who they are, and they are not told.</p>
        </Confirm>
      )}
      {dialog === 'report' && <ReportDialog targetType="question" targetId={question.id} onClose={() => setDialog(null)} />}
    </article>
  );
}

function Inbox() {
  const { me } = useApp();
  const { data, error, loading, reload, setData } = useLoad('/api/questions/inbox');
  const drop = (id) => setData((d) => ({ items: d.items.filter((q) => q.id !== id) }));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data.items.length) {
    return (
      <Empty title="No questions waiting">
        {me.allowQuestions
          ? <p>People can ask you from your profile. Share <Link to={`/u/${me.handle}`}>your profile</Link> to invite questions.</p>
          : <p>Anonymous questions are switched off. Turn them on in <Link to="/settings/privacy">privacy settings</Link>.</p>}
      </Empty>
    );
  }
  return data.items.map((q) => <InboxQuestion key={q.id} question={q} onGone={drop} />);
}

function Discover() {
  const list = usePaged('/api/questions/answers');
  return (
    <div aria-busy={list.loading}>
      {list.loading && !list.items.length && <Spinner />}
      <ErrorNote error={list.error} retry={list.reload} />
      {!list.loading && !list.error && !list.items.length && <Empty title="No answers yet">When someone answers a question, it shows up here.</Empty>}
      {list.items.map((a) => <AnswerCard key={a.id} answer={a} />)}
      <LoadMore list={list} />
    </div>
  );
}

function Asked() {
  const { data, error, loading, reload } = useLoad('/api/questions/sent');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data.items.length) return <Empty title="You have not asked anything yet">Use “Ask someone” above. Only you can see this list.</Empty>;
  return (
    <>
      <p className="muted small lede">Only you can see what you asked.</p>
      {data.items.map((q) => (
        <article key={q.id} className="post question">
          <header className="post-head">
            <Link className="post-author" to={`/u/${q.to.handle}`}><Avatar user={q.to} size="sm" /><span>To <span className="post-name">{q.to.displayName}</span></span></Link>
            <span className="muted post-time"><Time at={q.createdAt} /></span>
          </header>
          <blockquote className="asked">{q.body}</blockquote>
          {q.answered ? <p className="post-body">{q.answer}</p> : <p className="muted">Not answered yet.</p>}
        </article>
      ))}
    </>
  );
}

export default function Questions({ tab }) {
  const { counts } = useApp();
  const [target, setTarget] = useState(null);
  const [asking, setAsking] = useState(false);
  const [version, setVersion] = useState(0);
  const current = ['answers', 'asked'].includes(tab) ? tab : 'inbox';
  return (
    <section>
      <header className="page-head">
        <h2 className="page-title">Questions</h2>
        <Button variant="solid" onClick={() => setAsking(!asking)} aria-expanded={asking}>Ask someone</Button>
      </header>
      {asking && (
        <div className="panel">
          <PersonPicker label="Who do you want to ask?" autoFocus onPick={(u) => { setTarget(u); setAsking(false); }} />
        </div>
      )}
      <Tabs label="Questions" value={current} onChange={(t) => navigate(t === 'inbox' ? '/questions' : `/questions/${t}`)}
        tabs={[['inbox', 'Inbox', counts.questions], ['answers', 'Answers'], ['asked', 'Asked by you']]} />
      {current === 'inbox' && <Inbox />}
      {current === 'answers' && <Discover />}
      {current === 'asked' && <Asked key={version} />}
      {target && <AskDialog user={target} onClose={(sent) => { setTarget(null); if (sent) { setVersion((v) => v + 1); navigate('/questions/asked'); } }} />}
    </section>
  );
}
