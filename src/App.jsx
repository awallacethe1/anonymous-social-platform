import { useEffect } from 'react';
import { useApp } from './state.jsx';
import { Link, navigate, useLocation } from './router.jsx';
import { Button, Empty, Spinner } from './ui.jsx';
import { backgroundStyle } from './background.jsx';
import { Forgot, Login, Reset, Signup } from './pages/Auth.jsx';
import Welcome from './pages/Welcome.jsx';
import { Explore, Following, Search } from './pages/Feed.jsx';
import Create from './pages/Create.jsx';
import PostPage from './pages/PostPage.jsx';
import Questions from './pages/Questions.jsx';
import Messages from './pages/Messages.jsx';
import Notifications from './pages/Notifications.jsx';
import { BoardPage, Profile } from './pages/Profile.jsx';
import Settings, { Moderation } from './pages/Settings.jsx';
import Guidelines from './pages/Guidelines.jsx';

function Redirect({ to }) {
  useEffect(() => { navigate(to, { replace: true }); }, [to]);
  return null;
}

const TITLES = {
  '': 'Explore', following: 'Following', create: 'New post', questions: 'Questions', messages: 'Messages', notifications: 'Notifications',
  settings: 'Settings', search: 'Search', guidelines: 'Community guidelines', login: 'Sign in', signup: 'Create your account',
  forgot: 'Reset your password', reset: 'Choose a new password', moderation: 'Moderation', welcome: 'Welcome',
};

function Nav({ section }) {
  const { me, counts } = useApp();
  const items = [
    ['explore', '/', 'Explore', 'compass', 0],
    ['following', '/following', 'Following', 'people', 0],
    ['create', '/create', 'Create', 'plus', 0],
    ['questions', '/questions', 'Questions', 'question', counts.questions],
    ['messages', '/messages', 'Messages', 'mail', counts.messages],
    ['notifications', '/notifications', 'Notifications', 'bell', counts.notifications],
    ['profile', `/u/${me.handle}`, 'Profile', 'user', 0],
  ];
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([key, to, label, , count]) => (
        <Link key={key} to={to} className={`nav-link nav-${key} ${section === key ? 'nav-active' : ''}`} aria-current={section === key ? 'page' : undefined}>
          {label}
          {count > 0 && <span className="count" aria-label={`${count} new`}>{count > 99 ? '99+' : count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export default function App() {
  const { me, serverDown, retry } = useApp();
  const { query, segments } = useLocation();
  const [a = '', b, c] = segments;

  useEffect(() => {
    const title = a === 'u' ? `@${b}` : TITLES[a];
    document.title = title ? `${title} | Anonymous` : 'Anonymous';
  }, [a, b]);

  // The signed-in person's own app background sits behind everything.
  const appBackground = me?.appBackground;
  useEffect(() => {
    const style = backgroundStyle(appBackground);
    const body = document.body.style;
    body.background = '';
    body.backgroundImage = '';
    body.backgroundSize = '';
    body.backgroundPosition = '';
    body.backgroundRepeat = '';
    body.backgroundAttachment = '';
    if (style) Object.assign(body, style, { backgroundAttachment: 'fixed' });
    document.body.classList.toggle('has-app-background', !!appBackground);
  }, [appBackground]);

  if (serverDown) {
    return (
      <main className="auth" id="main">
        <h1 className="wordmark">ANONYMOUS</h1>
        <h2 className="auth-title">The server is not running</h2>
        <p>The pages are loading, but the part of the app that stores accounts and posts is not answering, so nothing will work yet.</p>
        <p className="server-help">In the VS Code terminal, stop anything that is running (Ctrl+C), then run <code>npm run dev</code> and read what it prints. It needs Node.js 22.13 or newer; <code>node -v</code> shows your version.</p>
        <Button variant="solid" onClick={retry}>Try again</Button>
      </main>
    );
  }

  if (me === undefined) return <div className="splash"><h1 className="wordmark">ANONYMOUS</h1><Spinner /></div>;

  if (!me) {
    if (a === 'signup') return <Signup />;
    if (a === 'forgot') return <Forgot />;
    if (a === 'reset') return <Reset token={query.get('token')} />;
    if (a === 'guidelines') return <div className="public-page"><Guidelines /></div>;
    return <Login />;
  }

  if (['login', 'signup', 'forgot', 'reset'].includes(a)) return <Redirect to="/" />;
  if (!me.onboarded && a !== 'guidelines') return <Welcome />;
  if (a === 'welcome') return <Redirect to="/" />;

  let page;
  let section = '';
  let wide = false;
  if (a === '') { page = <Explore query={query} />; section = 'explore'; }
  else if (a === 'search') { page = <Search query={query} />; section = 'explore'; }
  else if (a === 'following') { page = <Following query={query} />; section = 'following'; }
  else if (a === 'create') { page = <Create />; section = 'create'; }
  else if (a === 'post' && /^\d+$/.test(b || '')) page = <PostPage key={b} id={b} />;
  else if (a === 'questions') { page = <Questions tab={b} />; section = 'questions'; }
  else if (a === 'messages') { page = <Messages handle={b} />; section = 'messages'; wide = true; }
  else if (a === 'notifications') { page = <Notifications />; section = 'notifications'; }
  else if (a === 'u' && b) { page = <Profile key={b} handle={b} tab={c} />; section = b === me.handle ? 'profile' : ''; }
  else if (a === 'board' && /^\d+$/.test(b || '')) page = <BoardPage key={b} id={b} />;
  else if (a === 'settings') { page = <Settings section={b} />; section = 'profile'; }
  else if (a === 'moderation') page = <Moderation />;
  else if (a === 'guidelines') page = <Guidelines />;
  else page = <Empty title="Page not found">That address does not lead anywhere. <Link to="/">Back to Explore</Link></Empty>;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <h1 className="wordmark"><Link to="/" aria-label="Anonymous, home">ANONYMOUS</Link></h1>
        <Nav section={section} />
      </header>
      <main id="main" className={wide ? 'content content-wide' : 'content'}>{page}</main>
      <footer className="foot">Anonymous <Link to="/guidelines">Community guidelines</Link> <Link to="/settings">Settings</Link></footer>
    </div>
  );
}
