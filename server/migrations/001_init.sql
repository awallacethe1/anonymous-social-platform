-- Anonymous: initial schema. Times are integer milliseconds since epoch.

CREATE TABLE users (
  id               INTEGER PRIMARY KEY,
  handle           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name     TEXT NOT NULL DEFAULT '',
  password_hash    TEXT NOT NULL,
  bio              TEXT NOT NULL DEFAULT '',
  avatar           TEXT,
  cover            TEXT NOT NULL DEFAULT 'ink',
  cover_image      TEXT,
  music_url        TEXT,
  interests        TEXT NOT NULL DEFAULT '[]',
  dm_policy        TEXT NOT NULL DEFAULT 'everyone' CHECK (dm_policy IN ('everyone','following','none')),
  allow_questions  INTEGER NOT NULL DEFAULT 1,
  onboarded        INTEGER NOT NULL DEFAULT 0,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  suspended_at     INTEGER,
  totp_secret      TEXT,
  totp_enabled     INTEGER NOT NULL DEFAULT 0,
  totp_last_step   INTEGER NOT NULL DEFAULT 0,
  recovery_codes   TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL
);

CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  csrf          TEXT NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

CREATE TABLE uploads (
  name        TEXT PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE follows (
  follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows(followee_id);

CREATE TABLE blocks (
  blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks(blocked_id);

CREATE TABLE posts (
  id          INTEGER PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  image       TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX posts_author ON posts(author_id, created_at);
CREATE INDEX posts_created ON posts(created_at);

CREATE TABLE post_tags (
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_tags_tag ON post_tags(tag);

CREATE TABLE likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post ON likes(post_id);

CREATE TABLE reposts (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX reposts_post ON reposts(post_id);

CREATE TABLE comments (
  id          INTEGER PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX comments_post ON comments(post_id, created_at);

CREATE TABLE boards (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_private  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX boards_owner ON boards(owner_id);

CREATE TABLE board_items (
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (board_id, post_id)
);

-- sender_id exists only for abuse prevention and moderation.
-- It is never selected into anything that is sent to a browser.
CREATE TABLE questions (
  id            INTEGER PRIMARY KEY,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  answer        TEXT,
  answered_at   INTEGER,
  deleted_at    INTEGER
);
CREATE INDEX questions_recipient ON questions(recipient_id, created_at);
CREATE INDEX questions_sender ON questions(sender_id);

-- A recipient can silence whoever sent a question without learning who it was.
CREATE TABLE anon_blocks (
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (recipient_id, sender_id)
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER
);
CREATE INDEX messages_pair ON messages(sender_id, recipient_id, created_at);
CREATE INDEX messages_recipient ON messages(recipient_id, read_at);

CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  post_id      INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  question_id  INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);

CREATE TABLE reports (
  id           INTEGER PRIMARY KEY,
  reporter_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('post','comment','user','question','message')),
  target_id    INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution   TEXT,
  resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX reports_status ON reports(status, created_at);
