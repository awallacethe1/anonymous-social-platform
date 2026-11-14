import { api } from './api.js';
import { LIMITS } from '../shared/constants.js';

const load = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
  img.src = url;
});

/**
 * Shrink and re-encode a photo in the browser before it is uploaded. Re-drawing it on a canvas
 * also drops embedded metadata such as the camera's GPS location. (The server strips it again.)
 */
export async function prepareImage(file, { max = 1600, square = false } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.type === 'image/gif' && !square) {
    if (file.size > LIMITS.upload) throw new Error('GIFs can be up to 5 MB.');
    return file;
  }
  const img = await load(file);
  let { naturalWidth: w, naturalHeight: h } = img;
  let sx = 0, sy = 0;
  if (square) { const side = Math.min(w, h); sx = (w - side) / 2; sy = (h - side) / 2; w = h = side; }
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('That image could not be prepared. Try a different one.');
  return blob;
}

export async function uploadImage(file, options) {
  const blob = await prepareImage(file, options);
  const { url } = await api('/api/uploads', { method: 'POST', file: blob });
  return url;
}
