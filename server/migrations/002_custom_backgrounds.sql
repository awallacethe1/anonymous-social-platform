-- Fully customizable backgrounds, stored as small JSON objects:
--   {"type":"color","color":"#222222"}
--   {"type":"gradient","from":"#2b2140","to":"#b5546b","angle":135}
--   {"type":"image","url":"/uploads/<file>","fit":"cover"}             one picture, full screen
--   {"type":"image","url":"/uploads/<file>","fit":"tile","size":240}   the picture duplicated as tiles
-- background      = the band at the top of a person's profile (what visitors see)
-- app_background  = what the signed-in person sees behind the whole app

ALTER TABLE users ADD COLUMN background TEXT;
ALTER TABLE users ADD COLUMN app_background TEXT;

-- Carry over anything chosen with the earlier preset list.
UPDATE users SET background = CASE
  WHEN cover_image IS NOT NULL THEN json_object('type', 'image', 'url', cover_image)
  WHEN cover = 'paper' THEN json_object('type', 'color', 'color', '#f2f2f2')
  WHEN cover = 'ash'   THEN json_object('type', 'color', 'color', '#8c8c8c')
  WHEN cover = 'slate' THEN json_object('type', 'color', 'color', '#3b4652')
  WHEN cover = 'dusk'  THEN json_object('type', 'gradient', 'from', '#2b2140', 'to', '#b5546b', 'angle', 135)
  WHEN cover = 'moss'  THEN json_object('type', 'color', 'color', '#4a5d43')
  WHEN cover = 'rust'  THEN json_object('type', 'color', 'color', '#9a4a2b')
  WHEN cover = 'tide'  THEN json_object('type', 'gradient', 'from', '#0f3d4c', 'to', '#7fb5b0', 'angle', 135)
  WHEN cover = 'rose'  THEN json_object('type', 'color', 'color', '#d9a5a8')
  WHEN cover = 'sand'  THEN json_object('type', 'color', 'color', '#d8c7a6')
  ELSE NULL END;
