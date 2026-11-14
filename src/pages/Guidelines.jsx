import { useApp } from '../state.jsx';
import { Link } from '../router.jsx';

/** Plain-language rules and a factual account of what the app stores. */
export default function Guidelines() {
  const { me } = useApp();
  return (
    <article className="prose" id={me ? undefined : 'main'}>
      {!me && <p className="wordmark"><Link to="/login">ANONYMOUS</Link></p>}
      <h2 className="page-title">Community guidelines</h2>
      <p>Anonymous is a place to keep a personal corner of the internet and to be curious about other people’s. These rules keep it usable for everyone.</p>

      <h2>What is not allowed</h2>
      <ul>
        <li>Harassing, threatening or bullying anyone, in posts, comments, messages or anonymous questions.</li>
        <li>Hate directed at people for who they are.</li>
        <li>Sexual content involving minors, or sexual content sent to someone who did not ask for it.</li>
        <li>Encouraging self-harm.</li>
        <li>Spam, scams, and pretending to be another person.</li>
        <li>Posting someone’s private information without their consent.</li>
        <li>Music, images or writing you do not have the right to share. Profile music plays through the music service’s own player.</li>
      </ul>

      <h2>Anonymous questions</h2>
      <p>The person you ask never sees who you are, and neither does anyone else using the app. Anonymous does not mean unaccountable: the server keeps a private record of who sent each question so that limits and blocks work, and a moderator can see it when a question is reported.</p>

      <h2>Your controls</h2>
      <ul>
        <li>Block anyone from their profile or their posts. You disappear from each other completely, and they are not told.</li>
        <li>Report posts, comments, accounts, messages and questions from the “more” menu beside them.</li>
        <li>Choose who can message you, and switch anonymous questions on or off, in settings.</li>
        <li>Turn on two-step sign-in, review where you are signed in, download your data, or delete your account in settings.</li>
      </ul>

      <h2>What is stored</h2>
      <p>Your username, email address, a one-way hash of your password, and what you post, save and send. Your email is used only for account recovery and is never shown to other people. Photos are stripped of location data when you upload them. Deleting your account removes all of it.</p>

      <h2>Age</h2>
      <p>You need to be 13 or older to have an account.</p>
      {!me && <p><Link to="/signup">Create an account</Link> or <Link to="/login">sign in</Link>.</p>}
    </article>
  );
}
