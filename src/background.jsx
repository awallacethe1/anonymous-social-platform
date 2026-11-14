import { useId, useState } from 'react';
import { useApp } from './state.jsx';
import { Button } from './ui.jsx';
import { uploadImage } from './images.js';

const HEX = /^#[0-9a-f]{6}$/i;
const UPLOAD = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|gif)$/;

/** Turn a saved background into CSS. Anything that is not a plain color, gradient or uploaded image is ignored. */
export function backgroundStyle(bg) {
  if (!bg) return undefined;
  if (bg.type === 'color' && HEX.test(bg.color)) return { background: bg.color };
  if (bg.type === 'gradient' && HEX.test(bg.from) && HEX.test(bg.to)) {
    return { background: `linear-gradient(${Number(bg.angle) || 0}deg, ${bg.from}, ${bg.to})` };
  }
  if (bg.type === 'image' && UPLOAD.test(bg.url)) {
    if (bg.fit === 'tile') {
      const size = Math.min(800, Math.max(40, Number(bg.size) || 240));
      return { backgroundImage: `url("${bg.url}")`, backgroundSize: `${size}px auto`, backgroundPosition: 'top left', backgroundRepeat: 'repeat' };
    }
    return { backgroundImage: `url("${bg.url}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  }
  return undefined;
}

/** Choose any color, any two-color gradient at any angle, or your own image. */
export function BackgroundPicker({ legend, hint, value, onChange, defaultLabel, defaultColor = '#ffffff' }) {
  const { toast } = useApp();
  const id = useId();
  const [uploading, setUploading] = useState(false);
  const type = value?.type || 'default';

  const choose = (next) => {
    if (next === 'default') onChange(null);
    if (next === 'color') onChange({ type: 'color', color: value?.color || value?.from || (defaultColor === '#ffffff' ? '#f4efe6' : defaultColor) });
    if (next === 'gradient') onChange({ type: 'gradient', from: value?.from || value?.color || '#2b2140', to: value?.to || '#b5546b', angle: value?.angle ?? 135 });
    if (next === 'image' && value?.type !== 'image') document.getElementById(`${id}-file`)?.click();
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try { onChange({ type: 'image', url: await uploadImage(file, { max: 2000 }), fit: value?.fit || 'cover', size: value?.size || 240 }); }
    catch (err) { toast(err.message, 'error'); }
    setUploading(false);
  };

  const hexField = (key, label) => (
    <label className="color-field">
      <span>{label}</span>
      <input type="color" value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
      <input type="text" className="color-hex" aria-label={`${label} hex code`} maxLength={7} spellCheck={false} defaultValue={value[key]} key={value[key]}
        onBlur={(e) => { const v = e.target.value.trim(); if (HEX.test(v)) onChange({ ...value, [key]: v.toLowerCase() }); else e.target.value = value[key]; }} />
    </label>
  );

  return (
    <fieldset className="setting">
      <legend>{legend}</legend>
      {hint && <p className="muted small">{hint}</p>}
      <div className="row" role="radiogroup" aria-label={`${legend} type`}>
        {[['default', defaultLabel], ['color', 'Color'], ['gradient', 'Gradient'], ['image', 'Image']].map(([key, label]) => (
          <label key={key} className="choice"><input type="radio" name={`${id}-type`} checked={type === key} onChange={() => choose(key)} /><span>{label}</span></label>
        ))}
      </div>

      {type === 'color' && <div className="row">{hexField('color', 'Color')}</div>}
      {type === 'gradient' && (
        <div className="row">
          {hexField('from', 'From')}
          {hexField('to', 'To')}
          <label className="color-field">
            <span>Angle {value.angle}°</span>
            <input type="range" min="0" max="360" step="5" value={value.angle} onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })} />
          </label>
        </div>
      )}
      <input id={`${id}-file`} className="sr-only" type="file" accept="image/*" tabIndex={-1} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      {(type === 'image' || uploading) && (
        <div className="row">
          <Button className="btn-small" busy={uploading} onClick={() => document.getElementById(`${id}-file`)?.click()}>{uploading ? 'Uploading…' : 'Choose a different image'}</Button>
        </div>
      )}
      {type === 'image' && (
        <div className="row" role="radiogroup" aria-label={`${legend} picture layout`}>
          <label className="choice"><input type="radio" name={`${id}-fit`} checked={value.fit !== 'tile'} onChange={() => onChange({ ...value, fit: 'cover' })} /><span>Full screen</span></label>
          <label className="choice"><input type="radio" name={`${id}-fit`} checked={value.fit === 'tile'} onChange={() => onChange({ ...value, fit: 'tile', size: value.size || 240 })} /><span>Duplicate (repeat as tiles)</span></label>
          {value.fit === 'tile' && (
            <label className="color-field">
              <span>Tile size</span>
              <input type="range" min="40" max="800" step="20" value={value.size || 240} onChange={(e) => onChange({ ...value, size: Number(e.target.value) })} />
            </label>
          )}
        </div>
      )}
      <div className="bg-preview" style={backgroundStyle(value) || { background: defaultColor }} role="img" aria-label="Background preview" />
    </fieldset>
  );
}
