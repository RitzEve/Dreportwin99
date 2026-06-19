import { useRef, useState } from 'react';

/*
 * LogoManager — pick / replace / remove a company logo.
 *
 * The chosen image is downscaled in the browser (longest side <= MAX_DIM) and
 * turned into a small data-URL, so we can store it as plain text on the company
 * (no separate file storage to set up). Parents provide:
 *   currentLogo — the existing logo data-URL (or '' / null)
 *   onSave(dataUrl) — async, returns { ok, error? }
 *   onRemove()      — async, returns { ok, error? }
 */
const MAX_DIM = 256;                       // px — longest side after downscaling
const MAX_INPUT_BYTES = 5 * 1024 * 1024;   // reject source files over 5 MB

function fileToDownscaledDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_DIM / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // PNG keeps transparency, which most logos need.
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function LogoManager({ currentLogo, onSave, onRemove, note }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // let the user re-pick the same file later
    if (!file) return;
    setError(''); setOk('');
    if (!file.type.startsWith('image/')) return setError('Please choose an image file (PNG, JPG, etc.).');
    if (file.size > MAX_INPUT_BYTES) return setError('That image is too big — please use one under 5 MB.');
    setBusy(true);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file);
      const res = await onSave(dataUrl);
      setBusy(false);
      if (res && !res.ok) return setError(res.error);
      setOk('Logo updated.');
    } catch (err) {
      setBusy(false);
      setError(err.message || 'Could not process that image.');
    }
  }

  async function remove() {
    setError(''); setOk(''); setBusy(true);
    const res = await onRemove();
    setBusy(false);
    if (res && !res.ok) return setError(res.error);
    setOk('Logo removed — the company name will show again.');
  }

  return (
    <div>
      <div style={styles.row}>
        <div style={styles.preview}>
          {currentLogo
            ? <img src={currentLogo} alt="Company logo" style={styles.previewImg} />
            : <span style={styles.previewEmpty}>No logo</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
            <i className={`ti ti-${busy ? 'loader-2' : 'upload'}`} aria-hidden="true" /> {busy ? 'Uploading…' : (currentLogo ? 'Replace logo' : 'Upload logo')}
          </button>
          {currentLogo && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}>
              <i className="ti ti-trash" aria-hidden="true" /> Remove logo
            </button>
          )}
        </div>
      </div>
      {note && <p style={styles.note}>{note}</p>}
      {error && <div className="error-text">{error}</div>}
      {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
    </div>
  );
}

const styles = {
  row: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  preview: {
    width: 72, height: 72, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, flexShrink: 0, overflow: 'hidden',
  },
  previewImg: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  previewEmpty: { fontSize: 11, color: 'var(--muted)' },
  note: { fontSize: 12, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.5 },
};
