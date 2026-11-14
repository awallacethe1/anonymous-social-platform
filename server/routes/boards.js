import { bad, forbidden, notFound, text, integer } from '../http.js';
import { LIMITS } from '../config.js';
import { loadPost, loadPosts, visibleUser, publicUser, isBlockedBetween, now } from '../lib.js';

export default function boardRoutes(app) {
  const { router: r, db } = app;

  function ownBoard(ctx) {
    const board = db.get('SELECT * FROM boards WHERE id = ?', [integer(ctx.params.id)]);
    if (!board) throw notFound('That board');
    if (board.owner_id !== ctx.me.id) throw forbidden('That board belongs to someone else.');
    return board;
  }

  const summary = (me, b) => {
    const ids = db.all('SELECT post_id FROM board_items WHERE board_id = ? ORDER BY created_at DESC LIMIT 12', [b.id]).map((x) => x.post_id);
    const posts = loadPosts(app, me, ids);
    return {
      id: b.id, name: b.name, isPrivate: !!b.is_private,
      count: db.get('SELECT COUNT(*) c FROM board_items bi JOIN posts p ON p.id = bi.post_id WHERE bi.board_id = ? AND p.deleted_at IS NULL', [b.id]).c,
      preview: ids.filter((id) => posts.has(id)).slice(0, 4).map((id) => ({ image: posts.get(id).image, text: posts.get(id).body.slice(0, 90) })),
    };
  };

  /** Your own boards. With ?postId= each board also says whether it already holds that post. */
  r.get('/api/boards', (ctx) => {
    const postId = ctx.query.get('postId') ? integer(ctx.query.get('postId')) : null;
    return {
      items: db.all('SELECT * FROM boards WHERE owner_id = ? ORDER BY created_at DESC', [ctx.me.id]).map((b) => ({
        id: b.id, name: b.name, isPrivate: !!b.is_private,
        has: postId ? !!db.get('SELECT 1 x FROM board_items WHERE board_id = ? AND post_id = ?', [b.id, postId]) : false,
      })),
    };
  });

  r.get('/api/users/:handle/boards', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    const own = u.id === ctx.me.id;
    const rows = db.all(`SELECT * FROM boards WHERE owner_id = ? ${own ? '' : 'AND is_private = 0'} ORDER BY created_at DESC`, [u.id]);
    return { items: rows.map((b) => summary(ctx.me, b)) };
  });

  r.post('/api/boards', (ctx) => {
    const name = text(ctx.body.name, { name: 'Board name', max: LIMITS.boardName, min: 1, multiline: false });
    if (db.get('SELECT COUNT(*) c FROM boards WHERE owner_id = ?', [ctx.me.id]).c >= 100) throw bad('You have reached the limit of 100 boards.');
    if (db.get('SELECT 1 x FROM boards WHERE owner_id = ? AND name = ? COLLATE NOCASE', [ctx.me.id, name])) throw bad('You already have a board with that name.', 'name');
    const id = Number(db.run('INSERT INTO boards (owner_id, name, is_private, created_at) VALUES (?, ?, ?, ?)',
      [ctx.me.id, name, ctx.body.isPrivate ? 1 : 0, now()]).lastInsertRowid);
    ctx.status = 201;
    return { board: { id, name, isPrivate: !!ctx.body.isPrivate, has: false } };
  }, { limit: ['board', 30, 3600_000] });

  r.get('/api/boards/:id', (ctx) => {
    const b = db.get('SELECT b.*, u.handle, u.display_name, u.avatar, u.suspended_at FROM boards b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [integer(ctx.params.id)]);
    const own = b && b.owner_id === ctx.me.id;
    if (!b || b.suspended_at || (!own && (b.is_private || isBlockedBetween(db, ctx.me.id, b.owner_id)))) throw notFound('That board');
    const ids = db.all('SELECT post_id FROM board_items WHERE board_id = ? ORDER BY created_at DESC LIMIT 200', [b.id]).map((x) => x.post_id);
    const posts = loadPosts(app, ctx.me, ids);
    return {
      board: { id: b.id, name: b.name, isPrivate: !!b.is_private, owner: publicUser(b), mine: own },
      items: ids.filter((id) => posts.has(id)).map((id) => posts.get(id)),
    };
  });

  r.patch('/api/boards/:id', (ctx) => {
    const board = ownBoard(ctx);
    const name = 'name' in ctx.body ? text(ctx.body.name, { name: 'Board name', max: LIMITS.boardName, min: 1, multiline: false }) : board.name;
    if (db.get('SELECT 1 x FROM boards WHERE owner_id = ? AND name = ? COLLATE NOCASE AND id <> ?', [ctx.me.id, name, board.id])) throw bad('You already have a board with that name.', 'name');
    const isPrivate = 'isPrivate' in ctx.body ? (ctx.body.isPrivate ? 1 : 0) : board.is_private;
    db.run('UPDATE boards SET name = ?, is_private = ? WHERE id = ?', [name, isPrivate, board.id]);
    return { board: { id: board.id, name, isPrivate: !!isPrivate } };
  });

  r.delete('/api/boards/:id', (ctx) => { db.run('DELETE FROM boards WHERE id = ?', [ownBoard(ctx).id]); });

  r.put('/api/boards/:id/items/:postId', (ctx) => {
    const board = ownBoard(ctx);
    const post = loadPost(app, ctx.me, integer(ctx.params.postId));
    db.run('INSERT OR IGNORE INTO board_items (board_id, post_id, created_at) VALUES (?, ?, ?)', [board.id, post.id, now()]);
    return { post: loadPost(app, ctx.me, post.id) };
  });

  r.delete('/api/boards/:id/items/:postId', (ctx) => {
    const board = ownBoard(ctx);
    const postId = integer(ctx.params.postId);
    db.run('DELETE FROM board_items WHERE board_id = ? AND post_id = ?', [board.id, postId]);
    const post = loadPosts(app, ctx.me, [postId]).get(postId);
    return { post: post || null };
  });
}
