import { Component } from 'react';

/*
 * ErrorBoundary — catches render errors anywhere below it instead of letting
 * React unmount the whole app to a blank screen (its default behaviour with no
 * boundary at all). Shows a plain-language message + the raw error text (so it
 * can be screenshotted for diagnosis) + a Reload button, instead of nothing.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={styles.wrap}>
          <div style={styles.card}>
            <i className="ti ti-alert-triangle" aria-hidden="true" style={styles.icon} />
            <div style={styles.title}>Something went wrong</div>
            <div style={styles.body}>
              Your data is safe — this is only a display problem. Reloading usually fixes it.
            </div>
            <button type="button" onClick={() => window.location.reload()} style={styles.btn}>
              <i className="ti ti-refresh" aria-hidden="true" /> Reload
            </button>
            <div style={styles.detail}>{String((this.state.error && this.state.error.message) || this.state.error)}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg, #0a0e14)', color: 'var(--text, #f2f2f2)' },
  card: { maxWidth: 420, textAlign: 'center' },
  icon: { fontSize: 38, color: '#d97706', marginBottom: 12, display: 'block' },
  title: { fontSize: 18, fontWeight: 600, marginBottom: 8 },
  body: { fontSize: 13, opacity: 0.75, marginBottom: 20, lineHeight: 1.5 },
  btn: { cursor: 'pointer', padding: '10px 24px', borderRadius: 8, border: 'none', background: '#d4a72c', color: '#111', fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 },
  detail: { fontSize: 11, opacity: 0.5, marginTop: 20, wordBreak: 'break-word', fontFamily: 'monospace', lineHeight: 1.5 },
};
