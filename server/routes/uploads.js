import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bad } from '../http.js';
import { now } from '../lib.js';

/** Remove EXIF, XMP, comments and other metadata (which can include GPS location) from a JPEG. */
export function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // image data follows
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const keep = !(marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe);
    if (keep) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

/** Remove text, EXIF and timestamp chunks from a PNG, and anything after the end of the image. */
export function stripPng(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) return null;
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return null;
}

/** Decide the type from the file's own bytes, never from the name or the header the browser sent. */
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = buf.toString('latin1', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  return null;
}

export default function uploadRoutes(app) {
  const { router: r, db } = app;

  r.post('/api/uploads', async (ctx) => {
    let buf = ctx.body;
    if (!buf.length) throw bad('Choose an image to upload.');
    const type = sniffImage(buf);
    if (!type) throw bad('Upload a JPEG, PNG or GIF image.');
    if (type === 'jpg') buf = stripJpeg(buf);
    if (type === 'png') buf = stripPng(buf);
    if (!buf) throw bad('That image file is damaged. Try another one.');
    if (db.get('SELECT COUNT(*) c FROM uploads WHERE owner_id = ?', [ctx.me.id]).c >= 2000) throw bad('You have reached the upload limit for this account.');

    const name = `${crypto.randomBytes(16).toString('hex')}.${type}`;
    await fs.promises.writeFile(path.join(app.uploadsDir, name), buf, { mode: 0o640 });
    db.run('INSERT INTO uploads (name, owner_id, created_at) VALUES (?, ?, ?)', [name, ctx.me.id, now()]);
    ctx.status = 201;
    return { url: `/uploads/${name}` };
  }, { raw: true, limit: ['upload', 40, 3600_000] });
}
