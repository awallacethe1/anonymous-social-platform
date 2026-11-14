import { useEffect, useRef, useState } from 'react';
import { post as send } from '../api.js';
import { useApp } from '../state.jsx';
import { navigate } from '../router.jsx';
import { Icon } from '../icons.jsx';
import { Button, ErrorNote } from '../ui.jsx';
import { uploadImage } from '../images.js';
import { INTERESTS, LIMITS } from '../../shared/constants.js';

const DRAFT_KEY = 'anonymous:draft';

export default function Create() {
  const { toast } = useApp();
  const [body, setBody] = useState(() => { try { return sessionStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; } });
  const [tags, setTags] = useState([]);
  const [image, setImage] = useState(null); // { url, preview }
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  // Keep the words if the tab is refreshed by accident.
  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, body); } catch { /* storage unavailable */ } }, [body]);
  useEffect(() => () => { if (image?.preview) URL.revokeObjectURL(image.preview); }, [image]);

  const attach = async (file) => {
    if (!file) return;
    setUploading(true); setError(null);
    try { setImage({ url: await uploadImage(file), preview: URL.createObjectURL(file) }); }
    catch (err) { setError(err); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleTag = (t) => {
    if (tags.includes(t)) setTags(tags.filter((x) => x !== t));
    else if (tags.length < LIMITS.tagsPerPost) setTags([...tags, t]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { post } = await send('/api/posts', { body, image: image?.url || null, tags });
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      toast('Posted.');
      navigate(`/post/${post.id}`);
    } catch (err) { setError(err); setBusy(false); }
  };

  const left = LIMITS.post - body.length;
  const ready = (body.trim() || image) && left >= 0 && !uploading;

  return (
    <section>
      <header className="page-head"><h2 className="page-title">New post</h2></header>
      <form className="composer stack" onSubmit={submit}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); attach(e.dataTransfer.files?.[0]); }}>
        <label className="sr-only" htmlFor="composer-body">Your post</label>
        <textarea id="composer-body" className="composer-text" rows={7} placeholder="Share something…" value={body} onChange={(e) => setBody(e.target.value)} autoFocus
          onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f); } }} />

        {image && (
          <figure className="composer-image">
            <img src={image.preview} alt="Attached image preview" />
            <Button className="btn-small" onClick={() => setImage(null)}>Remove image</Button>
          </figure>
        )}

        <div className="row row-between">
          <div className="row">
            <input ref={fileRef} id="composer-file" className="sr-only" type="file" accept="image/*" onChange={(e) => attach(e.target.files?.[0])} />
            <label htmlFor="composer-file" className="btn btn-plain btn-small"><Icon name="image" size={18} /> {uploading ? 'Uploading…' : image ? 'Replace image' : 'Add image'}</label>
          </div>
          <span className={left < 0 ? 'counter counter-over' : 'counter muted'} aria-live="polite">{left < 100 ? `${left} left` : ''}</span>
        </div>

        <fieldset className="composer-topics">
          <legend>Topics <span className="muted">(up to {LIMITS.tagsPerPost}, optional)</span></legend>
          <div className="chips">
            {INTERESTS.map((t) => (
              <button key={t} type="button" className={tags.includes(t) ? 'chip chip-on' : 'chip'} aria-pressed={tags.includes(t)}
                disabled={!tags.includes(t) && tags.length >= LIMITS.tagsPerPost} onClick={() => toggleTag(t)}>{t}</button>
            ))}
          </div>
        </fieldset>

        <ErrorNote error={error} />
        <div className="row row-end">
          <Button onClick={() => window.history.back()}>Cancel</Button>
          <Button variant="solid" type="submit" busy={busy} disabled={!ready}>Post</Button>
        </div>
      </form>
    </section>
  );
}
