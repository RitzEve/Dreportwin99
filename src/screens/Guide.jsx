import { useEffect, useMemo, useState } from 'react';
import { ROLES } from '../lib/auth.js';
import { useEsc } from '../lib/useEsc.js';

/*
 * Guide — a full-screen, role-aware, trilingual "how to use" overlay.
 *
 *   • Role toggle (staff / manager / master) decides WHICH sections show.
 *     It defaults to the viewer's own role (a provider previews as master).
 *   • Language switch (English / 中文 / ភាសាខ្មែរ) decides WHAT WORDS show.
 *     It auto-detects the device language on first open, then remembers the
 *     choice in localStorage.
 *   • Every illustration is a hand-built SVG schematic with numbered pins
 *     (①②③) that line up with the numbered steps beside it — so it teaches
 *     in any language without text baked into the picture.
 *
 * Reached from: the AccountMenu "Help" item (console/provider) and a "?"
 * button in the Console header and the in-app top bar (the only route for
 * straight-to-app staff).
 */

const LANG_KEY = 'guide-lang-v1';
const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
  { id: 'km', label: 'ខ្មែរ' },
];
const ROLE_ORDER = [ROLES.STAFF, ROLES.MANAGER, ROLES.MASTER];

// Which sections each role sees, in display order. Provider is previewed as master.
const SECTIONS = [
  { id: 'welcome',     icon: 'ti-hand-stop',        roles: ['staff', 'manager', 'master'] },
  { id: 'signin',      icon: 'ti-login-2',          roles: ['staff', 'manager', 'master'] },
  { id: 'password',    icon: 'ti-key',              roles: ['staff', 'manager', 'master'] },
  { id: 'layout',      icon: 'ti-layout-navbar',    roles: ['staff', 'manager', 'master'] },
  { id: 'openapp',     icon: 'ti-wallet',           roles: ['manager', 'master'] },
  { id: 'transaction', icon: 'ti-cash',             roles: ['staff', 'manager', 'master'] },
  { id: 'txoptions',   icon: 'ti-checkbox',         roles: ['staff', 'manager', 'master'] },
  { id: 'members',     icon: 'ti-users',            roles: ['staff', 'manager', 'master'] },
  { id: 'banks',       icon: 'ti-building-bank',    roles: ['staff', 'manager', 'master'] },
  { id: 'shifts',      icon: 'ti-calendar-event',   roles: ['staff', 'manager', 'master'] },
  { id: 'team',        icon: 'ti-users-group',      roles: ['manager', 'master'] },
  { id: 'roles',       icon: 'ti-shield-check',     roles: ['master'] },
];

// ---- Tick-box tutorial config (the "Deposit & withdrawal options" section). ----
// Colours + icons mirror the tags the app actually shows in the transaction log,
// so the guide and the app read as one thing. The chart rows are language-neutral
// (a sign + a token key); the words come from the per-language `tok` / `rowLabels`.
const TK_ORDER = ['unclaimedDep', 'redeposit', 'storeWd', 'actualPaid', 'storePaid'];
const TK_UI = { unclaimedDep: 'Unclaimed Credit', redeposit: 'Redeposit', storeWd: 'Store withdraw', actualPaid: 'Actual paid amount', storePaid: 'Store + actual paid' };
const TK_COLOR = { unclaimedDep: '#d97706', redeposit: '#2563eb', storeWd: '#d97706', actualPaid: '#0d9488', storePaid: '#7c3aed' };
const TK_ICON = { unclaimedDep: 'ti-coin', redeposit: 'ti-refresh', storeWd: 'ti-building-store', actualPaid: 'ti-cash', storePaid: 'ti-arrows-split-2' };
// Each chart row: 5 cells = [Deposits, Withdrawals, Bank, Store, Unclaimed].
// A cell is [sign, tokenKey] or null (no change).
const CHART_ROWS = [
  { key: 'plainDep',     cells: [['+', 'amt'], null, ['+', 'amt'], null, null] },
  { key: 'plainWd',      cells: [null, ['+', 'amt'], ['-', 'amt'], null, null] },
  { key: 'unclaimedDep', cells: [['+', 'amt'], null, null, null, ['-', 'amt']] },
  { key: 'redeposit',    cells: [['+', 'amt'], ['+', 'amt'], null, null, null] },
  { key: 'storeWd',      cells: [null, ['+', 'amt'], null, ['-', 'store'], ['+', 'left']] },
  { key: 'actualPaid',   cells: [null, ['+', 'amt'], ['-', 'paid'], null, ['+', 'left']] },
  { key: 'storePaid',    cells: [null, ['+', 'amt'], ['-', 'paid'], ['-', 'store'], ['+', 'left']] },
];

// ---- Lazy font loader: pull Noto (Latin + Simplified Chinese + Khmer) only the
//      first time the guide is opened, so the rest of the portal stays light. ----
let fontsRequested = false;
function ensureGuideFonts() {
  if (fontsRequested || typeof document === 'undefined') return;
  fontsRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700' +
    '&family=Noto+Sans+SC:wght@400;500;700' +
    '&family=Noto+Sans+Khmer:wght@400;500;700&display=swap';
  document.head.appendChild(link);
}

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.some((l) => l.id === saved)) return saved;
  } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')).toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('km')) return 'km';
  return 'en';
}

export default function Guide({ open, role, onClose }) {
  const [lang, setLang] = useState(detectLang);
  const defaultRole = role === ROLES.PROVIDER || !ROLE_ORDER.includes(role) ? ROLES.MASTER : role;
  const [viewRole, setViewRole] = useState(defaultRole);

  // Each time the guide opens, start on the viewer's own role and load fonts.
  useEffect(() => {
    if (open) { setViewRole(defaultRole); ensureGuideFonts(); }
  }, [open, defaultRole]);

  useEsc(open, onClose);

  function pickLang(id) {
    setLang(id);
    try { localStorage.setItem(LANG_KEY, id); } catch { /* ignore */ }
  }

  const t = T[lang];
  const sections = useMemo(
    () => SECTIONS.filter((s) => s.roles.includes(viewRole)),
    [viewRole],
  );

  if (!open) return null;

  return (
    <div className="guide-overlay guide-font" role="dialog" aria-modal="true" aria-label={t.ui.title}>
      <div className="guide-topbar">
        <i className="ti ti-book-2" aria-hidden="true" style={{ fontSize: 20, color: 'var(--accent)' }} />
        <strong style={{ fontSize: 15 }}>{t.ui.title}</strong>
        <div className="guide-seg" style={{ marginLeft: 'auto' }} aria-label={t.ui.language}>
          {LANGS.map((l) => (
            <button key={l.id} className={l.id === lang ? 'is-active' : ''}
              onClick={() => pickLang(l.id)} lang={l.id}>{l.label}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t.ui.close}>
          <i className="ti ti-x" aria-hidden="true" /> {t.ui.close}
        </button>
      </div>

      <div className="guide-scroll">
        <div className="guide-inner">
          <p style={{ color: 'var(--muted)', margin: '0 0 18px', fontSize: 15 }}>{t.ui.subtitle}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t.ui.viewingAs}</span>
            <div className="guide-seg" aria-label={t.ui.viewingAs}>
              {ROLE_ORDER.map((r) => (
                <button key={r} className={r === viewRole ? 'is-active' : ''} onClick={() => setViewRole(r)}>
                  {t.ui.roles[r]}
                </button>
              ))}
            </div>
          </div>

          {sections.map((s, i) => {
            const c = t.s[s.id];
            return (
              <section key={s.id} className="guide-section">
                <div className="guide-section-head">
                  <span className="guide-section-num"><i className={`ti ${s.icon}`} aria-hidden="true" /></span>
                  <h2 style={{ margin: 0, fontSize: 19 }}>{i + 1}. {c.title}</h2>
                </div>
                <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>{c.intro}</p>
                {s.id === 'txoptions' ? (
                  <TxOptions c={c} />
                ) : (
                  <div className="guide-grid">
                    <ol className="guide-steps">
                      {c.steps.map((step, j) => <li key={j}>{step}</li>)}
                    </ol>
                    <figure className="guide-figure" style={{ margin: 0 }}>
                      <Mockup id={s.id} />
                    </figure>
                  </div>
                )}
              </section>
            );
          })}

          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 28, textAlign: 'center' }}>{t.ui.footer}</p>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   SVG MOCKUPS — schematic, theme-aware, language-free.
   Numbered pins (①②③) match the numbered steps beside each one.
   All colours come from CSS variables so they track light / dark.
   ===================================================================== */

function Pin({ x, y, n }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" className="guide-pin-bg" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="13" className="guide-pin-tx">{n}</text>
    </g>
  );
}

const svgProps = { viewBox: '0 0 320 200', role: 'img', 'aria-hidden': true };
const cv = (name) => `var(${name})`;

function Mockup({ id }) {
  switch (id) {
    case 'welcome':
      return (
        <svg {...svgProps}>
          <rect x="8" y="10" width="304" height="180" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="8" y="10" width="304" height="30" rx="12" fill={cv('--header')} />
          <rect x="8" y="34" width="304" height="6" fill={cv('--header')} />
          <circle cx="26" cy="25" r="6" fill={cv('--accent')} />
          <rect x="40" y="21" width="90" height="8" rx="4" fill={cv('--border-strong')} />
          <rect x="20" y="54" width="80" height="124" rx="8" fill={cv('--surface-2')} />
          {[0, 1, 2, 3].map((i) => <rect key={i} x="32" y={68 + i * 26} width="56" height="8" rx="4" fill={cv('--border-strong')} />)}
          <rect x="116" y="54" width="184" height="56" rx="8" fill={cv('--surface-2')} />
          <rect x="116" y="122" width="88" height="56" rx="8" fill={cv('--surface-2')} />
          <rect x="212" y="122" width="88" height="56" rx="8" fill={cv('--surface-2')} />
        </svg>
      );
    case 'signin':
      return (
        <svg {...svgProps}>
          <rect x="60" y="18" width="200" height="164" rx="14" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="84" y="36" width="120" height="10" rx="5" fill={cv('--border-strong')} />
          <rect x="84" y="64" width="152" height="26" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="84" y="104" width="152" height="26" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="84" y="144" width="152" height="26" rx="7" fill={cv('--accent')} />
          <Pin x={236} y={77} n="1" />
          <Pin x={236} y={117} n="2" />
          <Pin x={160} y={157} n="3" />
        </svg>
      );
    case 'password':
      return (
        <svg {...svgProps}>
          <rect x="50" y="14" width="220" height="172" rx="14" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="72" y="30" width="120" height="10" rx="5" fill={cv('--border-strong')} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x="72" y={56 + i * 34} width="176" height="24" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          ))}
          <rect x="160" y="158" width="88" height="22" rx="7" fill={cv('--accent')} />
          <Pin x={248} y={68} n="1" />
          <Pin x={248} y={102} n="2" />
          <Pin x={204} y={169} n="3" />
        </svg>
      );
    case 'layout':
      return (
        <svg {...svgProps}>
          <rect x="8" y="40" width="304" height="44" rx="10" fill={cv('--header')} stroke={cv('--border')} />
          <rect x="22" y="56" width="80" height="12" rx="6" fill={cv('--border-strong')} />
          <circle cx="214" cy="62" r="13" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="236" y="52" width="36" height="20" rx="10" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="282" y="50" width="22" height="24" rx="7" fill={cv('--accent-bg')} stroke={cv('--accent')} />
          <Pin x={214} y={62} n="1" />
          <Pin x={254} y={62} n="2" />
          <Pin x={293} y={62} n="3" />
          <rect x="8" y="100" width="304" height="86" rx="10" fill={cv('--surface-2')} />
        </svg>
      );
    case 'openapp':
      return (
        <svg {...svgProps}>
          <rect x="24" y="58" width="272" height="84" rx="14" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="40" y="78" width="44" height="44" rx="11" fill={cv('--accent-bg')} />
          <rect x="56" y="92" width="12" height="16" rx="2" fill={cv('--accent')} />
          <rect x="100" y="80" width="110" height="11" rx="5" fill={cv('--border-strong')} />
          <rect x="100" y="100" width="150" height="8" rx="4" fill={cv('--surface-2')} />
          <rect x="226" y="86" width="54" height="28" rx="8" fill={cv('--accent')} />
          <Pin x={280} y={100} n="1" />
        </svg>
      );
    case 'transaction':
      return (
        <svg {...svgProps}>
          <rect x="20" y="12" width="280" height="176" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="36" y="28" width="180" height="22" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          <g>
            <rect x="36" y="62" width="80" height="24" rx="7" fill={cv('--accent')} />
            <rect x="122" y="62" width="80" height="24" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
            <rect x="208" y="62" width="76" height="24" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          </g>
          <rect x="36" y="98" width="120" height="22" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="164" y="98" width="120" height="22" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="36" y="132" width="248" height="20" rx="7" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="208" y="160" width="76" height="22" rx="7" fill={cv('--accent')} />
          <Pin x={216} y={39} n="1" />
          <Pin x={284} y={109} n="2" />
          <Pin x={246} y={171} n="3" />
        </svg>
      );
    case 'members':
      return (
        <svg {...svgProps}>
          <rect x="20" y="14" width="280" height="172" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="36" y="28" width="200" height="24" rx="8" fill={cv('--surface-2')} stroke={cv('--border')} />
          <circle cx="48" cy="40" r="5" fill="none" stroke={cv('--muted')} strokeWidth="2" />
          <rect x="246" y="28" width="38" height="24" rx="8" fill={cv('--accent')} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="36" y={66 + i * 38} width="248" height="30" rx="8" fill={cv('--surface-2')} />
              <circle cx="54" cy={81 + i * 38} r="9" fill={cv('--border-strong')} />
              <rect x="72" y={76 + i * 38} width="90" height="8" rx="4" fill={cv('--border-strong')} />
            </g>
          ))}
          <Pin x={48} y={40} n="1" />
          <Pin x={284} y={81} n="2" />
          <Pin x={284} y={40} n="3" />
        </svg>
      );
    case 'banks':
      return (
        <svg {...svgProps}>
          <rect x="20" y="14" width="280" height="172" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="36" y={30 + i * 50} width="248" height="40" rx="9" fill={cv('--surface-2')} stroke={cv('--border')} />
              <rect x="50" y={42 + i * 50} width="26" height="16" rx="4" fill={cv('--accent-bg')} />
              <rect x="90" y={46 + i * 50} width="80" height="8" rx="4" fill={cv('--border-strong')} />
              <rect x="214" y={44 + i * 50} width="56" height="12" rx="6" fill={cv('--accent')} opacity="0.85" />
            </g>
          ))}
          <Pin x={284} y={50} n="1" />
          <Pin x={284} y={100} n="2" />
          <Pin x={50} y={150} n="3" />
        </svg>
      );
    case 'shifts':
      return (
        <svg {...svgProps}>
          <rect x="40" y="14" width="240" height="172" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="56" y="28" width="120" height="10" rx="5" fill={cv('--border-strong')} />
          <rect x="214" y="24" width="50" height="20" rx="7" fill={cv('--accent')} />
          {[0, 1, 2, 3].map((r) => (
            [0, 1, 2, 3, 4, 5, 6].map((col) => {
              const off = r === 1 && col === 3;
              return (
                <rect key={`${r}-${col}`} x={56 + col * 30} y={56 + r * 30} width="24" height="24" rx="6"
                  fill={off ? cv('--danger') : cv('--surface-2')} stroke={cv('--border')}
                  opacity={off ? 0.85 : 1} />
              );
            })
          ))}
          <Pin x={239} y={34} n="2" />
          <Pin x={146} y={98} n="1" />
          <Pin x={68} y={170} n="3" />
        </svg>
      );
    case 'team':
      return (
        <svg {...svgProps}>
          <rect x="20" y="12" width="280" height="176" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="36" y="26" width="248" height="44" rx="9" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="48" y="38" width="100" height="20" rx="6" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="158" y="38" width="70" height="20" rx="6" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="236" y="38" width="36" height="20" rx="6" fill={cv('--accent')} />
          {[0, 1].map((i) => (
            <g key={i}>
              <rect x="36" y={84 + i * 44} width="248" height="34" rx="9" fill={cv('--surface-2')} />
              <circle cx="54" cy={101 + i * 44} r="9" fill={cv('--border-strong')} />
              <rect x="72" y={96 + i * 44} width="90" height="8" rx="4" fill={cv('--border-strong')} />
              <rect x="214" y={94 + i * 44} width="24" height="14" rx="7" fill={cv('--surface')} stroke={cv('--border')} />
              <rect x="246" y={94 + i * 44} width="24" height="14" rx="7" fill={cv('--surface')} stroke={cv('--border')} />
            </g>
          ))}
          <Pin x={254} y={48} n="1" />
          <Pin x={284} y={101} n="2" />
          <Pin x={258} y={145} n="3" />
        </svg>
      );
    case 'roles':
      return (
        <svg {...svgProps}>
          <rect x="20" y="12" width="280" height="176" rx="12" fill={cv('--surface')} stroke={cv('--border')} />
          <rect x="36" y="28" width="248" height="36" rx="9" fill={cv('--surface-2')} />
          <circle cx="54" cy="46" r="9" fill={cv('--border-strong')} />
          <rect x="72" y="42" width="80" height="8" rx="4" fill={cv('--border-strong')} />
          <rect x="206" y="36" width="64" height="20" rx="7" fill={cv('--accent-bg')} stroke={cv('--accent')} />
          <rect x="36" y="80" width="118" height="44" rx="9" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="50" y="94" width="40" height="16" rx="4" fill={cv('--accent-bg')} />
          <rect x="166" y="80" width="118" height="44" rx="9" fill={cv('--surface-2')} stroke={cv('--border')} />
          <rect x="180" y="96" width="90" height="12" rx="6" fill={cv('--border-strong')} />
          <Pin x={238} y={46} n="1" />
          <Pin x={70} y={102} n="2" />
          <Pin x={225} y={102} n="3" />
        </svg>
      );
    default:
      return null;
  }
}

/* Custom body for the "Deposit & withdrawal options" section: a key-idea callout,
   the comparison chart, and one explainer card per tick-box (math + worked example). */
function TxOptions({ c }) {
  return (
    <>
      <div className="guide-callout">
        <i className="ti ti-bulb" aria-hidden="true" />
        <span>{c.note}</span>
      </div>

      <div className="guide-chart-wrap table-scroll">
        <table className="guide-chart">
          <thead>
            <tr>
              <th>{c.rowsHeader}</th>
              {c.colHeaders.map((h, i) => <th key={i}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {CHART_ROWS.map((row) => (
              <tr key={row.key}>
                <td>{c.rowLabels[row.key]}</td>
                {row.cells.map((cell, i) => {
                  if (!cell) return <td key={i} className="c-none">—</td>;
                  const [sign, tokKey] = cell;
                  return (
                    <td key={i} className={sign === '+' ? 'c-up' : 'c-down'}>
                      {sign === '+' ? '+' : '−'} {c.tok[tokKey]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {TK_ORDER.map((key) => {
        const it = c.items[key];
        return (
          <div key={key} className="guide-tk" style={{ '--tk': TK_COLOR[key] }}>
            <div className="guide-tk-head">
              <span className="guide-tk-name"><i className={`ti ${TK_ICON[key]}`} aria-hidden="true" /> {TK_UI[key]}</span>
            </div>
            <p className="guide-tk-for">{it.for}</p>
            <div className="guide-tk-formula">{it.formula}</div>
            <p className="guide-tk-ex">{it.example}</p>
          </div>
        );
      })}
    </>
  );
}

/* =====================================================================
   CONTENT — English, 简体中文, ភាសាខ្មែរ.
   Khmer is a best-effort translation; worth a native-speaker pass.
   All copy lives here so a fourth language is a contained add later.
   ===================================================================== */

const T = {
  en: {
    ui: {
      title: 'How to use FinTrack',
      subtitle: 'A short, friendly guide to the parts of the app that apply to you. Pick your language above, and switch "Viewing as" to see another role.',
      viewingAs: 'Viewing as:',
      language: 'Language',
      close: 'Close',
      roles: { staff: 'Staff', manager: 'Manager', master: 'Master' },
      footer: "That's the quick start. You can reopen this guide any time from your account menu or the “?” button.",
    },
    s: {
      welcome: {
        title: 'Welcome to FinTrack',
        intro: "FinTrack is your company's money workspace: record cash in and out, keep a member list, and track staff shifts.",
        steps: [
          'Your role decides what you see. Staff go straight to the app; managers and masters also get a console to manage their team.',
          'Use the language buttons at the top to read this guide in English, 中文 or ភាសាខ្មែរ.',
          'Switch the “Viewing as” buttons to preview what another role sees.',
        ],
      },
      signin: {
        title: 'Signing in',
        intro: 'You sign in with your email and password. There is no company to choose — your account already knows your company.',
        steps: [
          'Enter the email address your manager gave you.',
          'Enter your password, then press Sign in.',
          'If it says the details are wrong, check for typos or ask your manager to confirm your email.',
        ],
      },
      password: {
        title: 'Changing your password',
        intro: 'Your first password may be a temporary one. Change it to something only you know.',
        steps: [
          'Open your account menu and choose Change password.',
          'Type your current password, then your new password twice.',
          'Press Update. Use at least 6 characters and keep it private.',
        ],
      },
      layout: {
        title: 'Finding your way around',
        intro: 'The bar across the top is always there. It shows where you are and the controls you use most.',
        steps: [
          'The bell rings when a new version is available — open it to see what changed.',
          'The light / dark switch changes the look. Pick whichever is easier on your eyes.',
          'Your name on the right opens the account menu: change password, log out and this guide.',
        ],
      },
      openapp: {
        title: 'Opening the financial app',
        intro: 'Managers and masters land on the console first. The app is one tap away.',
        steps: [
          'On the console, press Open on the “Open Financial App” card.',
          'Work inside the app for as long as you need.',
          'Press Console (top-left) to return to team management.',
        ],
      },
      transaction: {
        title: 'Recording a transaction',
        intro: 'This is the main job: logging money coming in (deposit), going out (withdraw), or credit returned (redeposit).',
        steps: [
          'Choose the member, then pick the type: deposit, withdraw or redeposit.',
          'Enter the amount and the bank or store it touches, plus a note if useful.',
          'Press Enter to save. The record appears in the history straight away.',
        ],
      },
      txoptions: {
        title: 'Deposit & withdrawal options (the tick-boxes)',
        intro: "Most entries are a plain deposit or withdrawal. For special cases you can tick a box. The box never changes how big the withdrawal is — it only changes WHERE the money comes from, and anything left over is saved as the member's Unclaimed credit.",
        note: 'Rule of thumb: Total Withdrawals always shows the full amount. The tick-box only splits where it is funded from — a bank, store credit, or kept as Unclaimed credit. Left-over = amount − store − bank paid.',
        rowsHeader: 'Entry / option',
        colHeaders: ['Deposits total', 'Withdrawals total', 'Bank balance', 'Store credit', 'Unclaimed credit'],
        rowLabels: {
          plainDep: 'Plain deposit',
          plainWd: 'Plain withdrawal',
          unclaimedDep: 'Deposit · from Unclaimed',
          redeposit: 'Redeposit',
          storeWd: 'Store withdraw',
          actualPaid: 'Actual paid amount',
          storePaid: 'Store + actual paid',
        },
        tok: { amt: 'amount', store: 'store', paid: 'paid', left: 'left-over' },
        items: {
          unclaimedDep: {
            for: 'A deposit paid from credit the member is already owed, instead of new cash. (Tick it on a Regular Deposit.)',
            formula: 'Deposit = Unclaimed credit used   ·   no bank, no new money',
            example: "A member is owed $50 from before. Deposit $50 from unclaimed → Deposits +$50 and that day's Unclaimed credit −$50. No bank changes.",
          },
          redeposit: {
            for: 'The member takes money out and puts the same amount straight back. (Tick it on a Regular Withdrawal.)',
            formula: 'Out = In = amount   ·   every bank balance unchanged',
            example: 'Redeposit $100 → Total Withdrawals +$100 AND Total Deposits +$100, but no bank balance moves, even if a bank is selected.',
          },
          storeWd: {
            for: 'A withdrawal paid from store credit instead of a bank. (Tick it on a Regular Withdrawal.)',
            formula: 'Withdrawal = store + left-over   ·   left-over → Unclaimed',
            example: 'Withdraw $80, store amount $60 → Withdrawals +$80, Store credit −$60, and the $20 left-over becomes Unclaimed credit. No bank is touched.',
          },
          actualPaid: {
            for: 'The bank pays only part of the withdrawal; the rest is owed. (Tick it on a Regular Withdrawal.)',
            formula: 'Withdrawal = bank paid + left-over   ·   left-over → Unclaimed',
            example: 'Withdraw $100, bank pays $70 → Withdrawals +$100, the bank −$70, and the $30 left-over becomes Unclaimed credit.',
          },
          storePaid: {
            for: 'A withdrawal split across store credit AND the bank; the rest is owed. (Tick it on a Regular Withdrawal.)',
            formula: 'Withdrawal = store + bank paid + left-over   ·   left-over → Unclaimed',
            example: 'Withdraw $100, store $60, bank pays $30 → Withdrawals +$100, Store −$60, bank −$30, and the $10 left-over becomes Unclaimed credit.',
          },
        },
      },
      members: {
        title: 'The members directory',
        intro: 'Every person you transact for is a member. The directory keeps their details and history in one place.',
        steps: [
          'Open Members to search by name, member ID or phone number.',
          'Click a member to see their full transaction history.',
          'Add a new member when someone is not on the list yet.',
        ],
      },
      banks: {
        title: 'Bank accounts & store credit',
        intro: 'Money lives in bank accounts and in store credit. Keeping these right makes your totals trustworthy.',
        steps: [
          'Open Banks to see each account and its current balance.',
          'When a transaction uses a bank, choose the right one so the balance stays correct.',
          'Store credit covers unclaimed amounts — use it when a transaction draws from credit, not a bank.',
        ],
      },
      shifts: {
        title: 'Work shifts & days off',
        intro: 'Track who is working and plan days off so the schedule stays clear.',
        steps: [
          'Pick a day on the calendar.',
          'Press Plan a day off to book time away.',
          'The log shows who is off today and the days ahead.',
        ],
      },
      team: {
        title: 'Managing your team',
        intro: 'Managers and masters create and manage the accounts under them, on the console.',
        steps: [
          'In Team & accounts, fill the form to create an account. A master can add managers and staff; a manager can add staff.',
          'Each new account gets a temporary password — share it, and they change it on first sign-in.',
          "Use a row's controls to deactivate, edit or remove an account you manage.",
        ],
      },
      roles: {
        title: 'Roles & company settings (Master)',
        intro: 'Masters have the widest control: managers, staff, roles, and a couple of company-wide settings.',
        steps: [
          "Change a person's role from the team list when their responsibilities change.",
          'Set the company logo so it shows across the app for everyone.',
          'Set the company timezone so dates and times match where you work.',
        ],
      },
    },
  },

  zh: {
    ui: {
      title: '如何使用 FinTrack',
      subtitle: '这是一份简短、友好的指南，只讲与你相关的部分。请在上方选择语言，并切换“查看身份”以了解其他角色的界面。',
      viewingAs: '查看身份：',
      language: '语言',
      close: '关闭',
      roles: { staff: '员工', manager: '经理', master: '主管' },
      footer: '快速入门到此结束。你随时可以从账户菜单或“?”按钮重新打开本指南。',
    },
    s: {
      welcome: {
        title: '欢迎使用 FinTrack',
        intro: 'FinTrack 是你公司的资金工作台：记录收入与支出、维护会员名单、并跟踪员工班次。',
        steps: [
          '你的角色决定你能看到的内容。员工直接进入应用；经理和主管还会有一个用于管理团队的控制台。',
          '使用顶部的语言按钮，以 English、中文或 ភាសាខ្មែរ 阅读本指南。',
          '切换“查看身份”按钮，可预览其他角色看到的界面。',
        ],
      },
      signin: {
        title: '登录',
        intro: '你使用邮箱和密码登录。无需选择公司——你的账户已经绑定了所属公司。',
        steps: [
          '输入经理给你的邮箱地址。',
          '输入密码，然后点击“登录”。',
          '若提示信息有误，请检查是否打错字，或请经理确认你的邮箱。',
        ],
      },
      password: {
        title: '修改密码',
        intro: '你的首个密码可能是临时密码。请改成只有你自己知道的密码。',
        steps: [
          '打开账户菜单，选择“修改密码”。',
          '输入当前密码，再输入两次新密码。',
          '点击“更新”。请至少使用 6 个字符，并妥善保密。',
        ],
      },
      layout: {
        title: '熟悉界面',
        intro: '顶部的横栏始终存在，它显示你所在的位置以及最常用的控件。',
        steps: [
          '有新版本时铃铛会提醒——点击即可查看更新内容。',
          '“浅色 / 深色”开关可切换外观，选你看着更舒服的一种。',
          '右侧的你的名字会打开账户菜单：修改密码、退出登录以及本指南。',
        ],
      },
      openapp: {
        title: '打开财务应用',
        intro: '经理和主管会先进入控制台。点击一下即可打开应用。',
        steps: [
          '在控制台上，点击“打开财务应用”卡片中的“打开”。',
          '在应用中按需要进行操作。',
          '点击左上角的“控制台”可返回团队管理。',
        ],
      },
      transaction: {
        title: '记录一笔交易',
        intro: '这是主要工作：记录入账（存入）、出账（取出）或退回额度（再存入）。',
        steps: [
          '先选择会员，再选择类型：存入、取出或再存入。',
          '填写金额以及涉及的银行或商店额度，必要时加上备注。',
          '点击“确认”保存，记录会立即出现在历史中。',
        ],
      },
      txoptions: {
        title: '存款与取款的选项（勾选框）',
        intro: '大多数记录就是普通的存款或取款。遇到特殊情况时，你可以勾选一个方框。勾选框从不改变取款的金额，它只改变这笔钱从哪里出——剩下未被覆盖的部分会作为该会员的“未领取额度”保存。',
        note: '要点：取款总额始终显示完整金额。勾选框只决定这笔钱从哪里出——银行、商店额度，或记为未领取额度。剩余 = 金额 − 商店 − 银行支付。',
        rowsHeader: '记录 / 选项',
        colHeaders: ['存款总额', '取款总额', '银行余额', '商店额度', '未领取额度'],
        rowLabels: {
          plainDep: '普通存款',
          plainWd: '普通取款',
          unclaimedDep: '存款 · 来自未领取',
          redeposit: '再存入',
          storeWd: '商店取款',
          actualPaid: '实付金额',
          storePaid: '商店 + 实付',
        },
        tok: { amt: '金额', store: '商店', paid: '支付', left: '剩余' },
        items: {
          unclaimedDep: {
            for: '用会员已被欠下的额度来做一笔存款，而不是新的现金。（在“普通存款”上勾选。）',
            formula: '存款 = 使用的未领取额度   ·   不动银行，不产生新钱',
            example: '某会员之前被欠 $50。从未领取额度存入 $50 → 存款 +$50，当天的未领取额度 −$50。银行不变。',
          },
          redeposit: {
            for: '会员把钱取出后又立即把同样的金额放回。（在“普通取款”上勾选。）',
            formula: '取出 = 存入 = 金额   ·   所有银行余额不变',
            example: '再存入 $100 → 取款总额 +$100，同时存款总额 +$100，但即使选了银行，任何银行余额都不变动。',
          },
          storeWd: {
            for: '用商店额度而不是银行来支付的取款。（在“普通取款”上勾选。）',
            formula: '取款 = 商店 + 剩余   ·   剩余 → 未领取',
            example: '取款 $80，商店金额 $60 → 取款 +$80，商店额度 −$60，剩余的 $20 变成未领取额度。不动银行。',
          },
          actualPaid: {
            for: '银行只支付取款的一部分，其余的算作欠款。（在“普通取款”上勾选。）',
            formula: '取款 = 银行支付 + 剩余   ·   剩余 → 未领取',
            example: '取款 $100，银行支付 $70 → 取款 +$100，银行 −$70，剩余的 $30 变成未领取额度。',
          },
          storePaid: {
            for: '取款由商店额度和银行共同分担，其余的算作欠款。（在“普通取款”上勾选。）',
            formula: '取款 = 商店 + 银行支付 + 剩余   ·   剩余 → 未领取',
            example: '取款 $100，商店 $60，银行支付 $30 → 取款 +$100，商店 −$60，银行 −$30，剩余的 $10 变成未领取额度。',
          },
        },
      },
      members: {
        title: '会员名录',
        intro: '你为之交易的每个人都是会员。名录把他们的资料和历史集中在一处。',
        steps: [
          '打开“会员”，按姓名、会员编号或电话号码搜索。',
          '点击某个会员，查看其完整交易历史。',
          '当某人还不在名单上时，添加新会员。',
        ],
      },
      banks: {
        title: '银行账户与商店额度',
        intro: '资金存放在银行账户和商店额度中。把它们维护准确，你的总额才可信。',
        steps: [
          '打开“银行”，查看每个账户及其当前余额。',
          '当交易涉及银行时，选对账户，余额才会保持正确。',
          '商店额度用于未领取的金额——当交易从额度（而非银行）扣款时使用它。',
        ],
      },
      shifts: {
        title: '班次与休息日',
        intro: '跟踪谁在上班，并安排休息日，让排班一目了然。',
        steps: [
          '在日历上选择某一天。',
          '点击“安排休息日”以预约休假。',
          '记录会显示今天谁休息以及未来几天的安排。',
        ],
      },
      team: {
        title: '管理你的团队',
        intro: '经理和主管在控制台上创建并管理其下属的账户。',
        steps: [
          '在“团队与账户”中填写表单创建账户。主管可添加经理和员工；经理可添加员工。',
          '每个新账户都会有一个临时密码——把它告诉对方，对方首次登录时自行修改。',
          '使用某一行的控件，可停用、编辑或删除你所管理的账户。',
        ],
      },
      roles: {
        title: '角色与公司设置（主管）',
        intro: '主管拥有最大的权限：经理、员工、角色，以及若干全公司范围的设置。',
        steps: [
          '当某人职责变化时，在团队列表中更改其角色。',
          '设置公司标志，让它在应用中向所有人显示。',
          '设置公司时区，让日期和时间与你所在地一致。',
        ],
      },
    },
  },

  km: {
    ui: {
      title: 'របៀបប្រើ FinTrack',
      subtitle: 'ការណែនាំខ្លី និងងាយស្រួល អំពីផ្នែកនៃកម្មវិធីដែលទាក់ទងនឹងអ្នក។ សូមជ្រើសភាសារបស់អ្នកខាងលើ ហើយប្ដូរ «មើលជា» ដើម្បីឃើញតួនាទីផ្សេងទៀត។',
      viewingAs: 'មើលជា៖',
      language: 'ភាសា',
      close: 'បិទ',
      roles: { staff: 'បុគ្គលិក', manager: 'អ្នកគ្រប់គ្រង', master: 'ប្រធាន' },
      footer: 'នេះគឺជាការចាប់ផ្ដើមរហ័ស។ អ្នកអាចបើកការណែនាំនេះឡើងវិញបានគ្រប់ពេល ពីម៉ឺនុយគណនី ឬប៊ូតុង «?»។',
    },
    s: {
      welcome: {
        title: 'សូមស្វាគមន៍មកកាន់ FinTrack',
        intro: 'FinTrack គឺជាកន្លែងគ្រប់គ្រងលុយរបស់ក្រុមហ៊ុនអ្នក៖ កត់ត្រាលុយចូល និងចេញ រក្សាបញ្ជីសមាជិក និងតាមដានវេនការងាររបស់បុគ្គលិក។',
        steps: [
          'តួនាទីរបស់អ្នកកំណត់នូវអ្វីដែលអ្នកឃើញ។ បុគ្គលិកចូលទៅកម្មវិធីផ្ទាល់ រីឯអ្នកគ្រប់គ្រង និងប្រធាន ក៏មានផ្ទាំងបញ្ជា ដើម្បីគ្រប់គ្រងក្រុមរបស់ខ្លួនផងដែរ។',
          'ប្រើប៊ូតុងភាសានៅខាងលើ ដើម្បីអានការណែនាំនេះជា English, 中文 ឬ ភាសាខ្មែរ។',
          'ប្ដូរប៊ូតុង «មើលជា» ដើម្បីមើលនូវអ្វីដែលតួនាទីផ្សេងទៀតឃើញ។',
        ],
      },
      signin: {
        title: 'ការចូលគណនី',
        intro: 'អ្នកចូលដោយប្រើអ៊ីមែល និងពាក្យសម្ងាត់របស់អ្នក។ មិនចាំបាច់ជ្រើសក្រុមហ៊ុនទេ — គណនីរបស់អ្នកដឹងពីក្រុមហ៊ុនរបស់អ្នករួចហើយ។',
        steps: [
          'បញ្ចូលអាសយដ្ឋានអ៊ីមែលដែលអ្នកគ្រប់គ្រងបានផ្ដល់ឱ្យអ្នក។',
          'បញ្ចូលពាក្យសម្ងាត់ រួចចុច «ចូល»។',
          'បើវាប្រាប់ថាព័ត៌មានខុស សូមពិនិត្យអក្ខរាវិរុទ្ធ ឬសុំឱ្យអ្នកគ្រប់គ្រងបញ្ជាក់អ៊ីមែលរបស់អ្នក។',
        ],
      },
      password: {
        title: 'ការផ្លាស់ប្ដូរពាក្យសម្ងាត់',
        intro: 'ពាក្យសម្ងាត់ដំបូងរបស់អ្នកអាចជាពាក្យសម្ងាត់បណ្ដោះអាសន្ន។ សូមប្ដូរវាទៅជាពាក្យដែលមានតែអ្នកដឹង។',
        steps: [
          'បើកម៉ឺនុយគណនីរបស់អ្នក ហើយជ្រើស «ផ្លាស់ប្ដូរពាក្យសម្ងាត់»។',
          'វាយពាក្យសម្ងាត់បច្ចុប្បន្ន រួចវាយពាក្យសម្ងាត់ថ្មីពីរដង។',
          'ចុច «ធ្វើបច្ចុប្បន្នភាព»។ សូមប្រើយ៉ាងតិច ៦ តួអក្សរ ហើយរក្សាជាការសម្ងាត់។',
        ],
      },
      layout: {
        title: 'ការស្គាល់ផ្ទៃកម្មវិធី',
        intro: 'របារខាងលើមានជានិច្ច។ វាបង្ហាញពីកន្លែងដែលអ្នកនៅ និងឧបករណ៍បញ្ជាដែលអ្នកប្រើញឹកញាប់បំផុត។',
        steps: [
          'កណ្ដឹងនឹងរោទ៍នៅពេលមានកំណែថ្មី — ចុចវាដើម្បីមើលអ្វីដែលបានផ្លាស់ប្ដូរ។',
          'ប៊ូតុង ភ្លឺ / ងងឹត ប្ដូររូបរាង។ ជ្រើសយកមួយណាដែលធ្វើឱ្យភ្នែកអ្នកស្រួលជាង។',
          'ឈ្មោះរបស់អ្នកនៅខាងស្ដាំ បើកម៉ឺនុយគណនី៖ ផ្លាស់ប្ដូរពាក្យសម្ងាត់ ចាកចេញ និងការណែនាំនេះ។',
        ],
      },
      openapp: {
        title: 'ការបើកកម្មវិធីហិរញ្ញវត្ថុ',
        intro: 'អ្នកគ្រប់គ្រង និងប្រធាន ចូលដល់ផ្ទាំងបញ្ជាជាមុនសិន។ កម្មវិធីនៅចម្ងាយត្រឹមមួយចុច។',
        steps: [
          'នៅលើផ្ទាំងបញ្ជា ចុច «បើក» នៅលើកាត «បើកកម្មវិធីហិរញ្ញវត្ថុ»។',
          'ធ្វើការនៅក្នុងកម្មវិធីតាមតម្រូវការ។',
          'ចុច «ផ្ទាំងបញ្ជា» (ខាងលើឆ្វេង) ដើម្បីត្រឡប់ទៅការគ្រប់គ្រងក្រុមវិញ។',
        ],
      },
      transaction: {
        title: 'ការកត់ត្រាប្រតិបត្តិការ',
        intro: 'នេះជាការងារសំខាន់៖ កត់ត្រាលុយចូល (ដាក់ប្រាក់) លុយចេញ (ដកប្រាក់) ឬឥណទានដែលត្រឡប់មកវិញ (ដាក់ប្រាក់ឡើងវិញ)។',
        steps: [
          'ជ្រើសសមាជិក រួចជ្រើសប្រភេទ៖ ដាក់ប្រាក់ ដកប្រាក់ ឬដាក់ប្រាក់ឡើងវិញ។',
          'បញ្ចូលចំនួនទឹកប្រាក់ និងធនាគារ ឬឥណទានហាងដែលពាក់ព័ន្ធ ព្រមទាំងចំណាំបើចាំបាច់។',
          'ចុច «បញ្ជាក់» ដើម្បីរក្សាទុក។ កំណត់ត្រានឹងបង្ហាញក្នុងប្រវត្តិភ្លាមៗ។',
        ],
      },
      txoptions: {
        title: 'ជម្រើសដាក់ប្រាក់ និងដកប្រាក់ (ប្រអប់ធីក)',
        intro: 'កំណត់ត្រាភាគច្រើនគ្រាន់តែជាការដាក់ប្រាក់ ឬដកប្រាក់ធម្មតា។ សម្រាប់ករណីពិសេស អ្នកអាចធីកប្រអប់មួយ។ ប្រអប់នេះមិនផ្លាស់ប្ដូរទំហំនៃការដកប្រាក់ឡើយ — វាគ្រាន់តែផ្លាស់ប្ដូរថាលុយចេញពីណា ហើយផ្នែកដែលនៅសល់ត្រូវរក្សាទុកជា «ឥណទានមិនទាន់ដក» របស់សមាជិក។',
        note: 'គោលការណ៍៖ ការដកសរុបតែងតែបង្ហាញចំនួនពេញ។ ប្រអប់ធីកគ្រាន់តែបែងចែកថាលុយចេញពីណា — ធនាគារ ឥណទានហាង ឬរក្សាជាឥណទានមិនទាន់ដក។ នៅសល់ = ចំនួន − ហាង − ធនាគារបង់។',
        rowsHeader: 'កំណត់ត្រា / ជម្រើស',
        colHeaders: ['ដាក់ប្រាក់សរុប', 'ដកប្រាក់សរុប', 'សមតុល្យធនាគារ', 'ឥណទានហាង', 'ឥណទានមិនទាន់ដក'],
        rowLabels: {
          plainDep: 'ដាក់ប្រាក់ធម្មតា',
          plainWd: 'ដកប្រាក់ធម្មតា',
          unclaimedDep: 'ដាក់ប្រាក់ · ពីមិនទាន់ដក',
          redeposit: 'ដាក់ប្រាក់ឡើងវិញ',
          storeWd: 'ដកពីហាង',
          actualPaid: 'ចំនួនបង់ពិត',
          storePaid: 'ហាង + បង់ពិត',
        },
        tok: { amt: 'ចំនួន', store: 'ហាង', paid: 'បង់', left: 'នៅសល់' },
        items: {
          unclaimedDep: {
            for: 'ការដាក់ប្រាក់ដែលបង់ពីឥណទានដែលសមាជិកត្រូវបានជំពាក់រួចហើយ ជំនួសឱ្យសាច់ប្រាក់ថ្មី។ (ធីកនៅលើ «ដាក់ប្រាក់ធម្មតា»។)',
            formula: 'ដាក់ប្រាក់ = ឥណទានមិនទាន់ដកដែលប្រើ   ·   មិនប៉ះធនាគារ មិនមានលុយថ្មី',
            example: 'សមាជិកម្នាក់ត្រូវបានជំពាក់ $50 ពីមុន។ ដាក់ប្រាក់ $50 ពីឥណទានមិនទាន់ដក → ដាក់ប្រាក់ +$50 ហើយឥណទានមិនទាន់ដកថ្ងៃនោះ −$50។ ធនាគារមិនប្រែប្រួល។',
          },
          redeposit: {
            for: 'សមាជិកដកប្រាក់ចេញ ហើយដាក់ចំនួនដដែលត្រឡប់វិញភ្លាមៗ។ (ធីកនៅលើ «ដកប្រាក់ធម្មតា»។)',
            formula: 'ចេញ = ចូល = ចំនួន   ·   សមតុល្យធនាគារទាំងអស់មិនប្រែ',
            example: 'ដាក់ប្រាក់ឡើងវិញ $100 → ដកប្រាក់សរុប +$100 និងដាក់ប្រាក់សរុប +$100 ប៉ុន្តែគ្មានសមតុល្យធនាគារណាផ្លាស់ប្ដូរ ទោះបីជ្រើសធនាគារក៏ដោយ។',
          },
          storeWd: {
            for: 'ការដកប្រាក់ដែលបង់ពីឥណទានហាង ជំនួសឱ្យធនាគារ។ (ធីកនៅលើ «ដកប្រាក់ធម្មតា»។)',
            formula: 'ដកប្រាក់ = ហាង + នៅសល់   ·   នៅសល់ → មិនទាន់ដក',
            example: 'ដក $80 ចំនួនហាង $60 → ដកប្រាក់ +$80 ឥណទានហាង −$60 ហើយ $20 ដែលនៅសល់ក្លាយជាឥណទានមិនទាន់ដក។ មិនប៉ះធនាគារ។',
          },
          actualPaid: {
            for: 'ធនាគារបង់តែផ្នែកមួយនៃការដក ឯផ្នែកដែលនៅសល់ត្រូវជំពាក់។ (ធីកនៅលើ «ដកប្រាក់ធម្មតា»។)',
            formula: 'ដកប្រាក់ = ធនាគារបង់ + នៅសល់   ·   នៅសល់ → មិនទាន់ដក',
            example: 'ដក $100 ធនាគារបង់ $70 → ដកប្រាក់ +$100 ធនាគារ −$70 ហើយ $30 ដែលនៅសល់ក្លាយជាឥណទានមិនទាន់ដក។',
          },
          storePaid: {
            for: 'ការដកប្រាក់បែងចែករវាងឥណទានហាង និងធនាគារ ឯផ្នែកដែលនៅសល់ត្រូវជំពាក់។ (ធីកនៅលើ «ដកប្រាក់ធម្មតា»។)',
            formula: 'ដកប្រាក់ = ហាង + ធនាគារបង់ + នៅសល់   ·   នៅសល់ → មិនទាន់ដក',
            example: 'ដក $100 ហាង $60 ធនាគារបង់ $30 → ដកប្រាក់ +$100 ហាង −$60 ធនាគារ −$30 ហើយ $10 ដែលនៅសល់ក្លាយជាឥណទានមិនទាន់ដក។',
          },
        },
      },
      members: {
        title: 'បញ្ជីឈ្មោះសមាជិក',
        intro: 'មនុស្សគ្រប់រូបដែលអ្នកធ្វើប្រតិបត្តិការជំនួស គឺជាសមាជិក។ បញ្ជីនេះរក្សាព័ត៌មាន និងប្រវត្តិរបស់ពួកគេនៅកន្លែងតែមួយ។',
        steps: [
          'បើក «សមាជិក» ដើម្បីស្វែងរកតាមឈ្មោះ លេខសម្គាល់សមាជិក ឬលេខទូរស័ព្ទ។',
          'ចុចលើសមាជិកម្នាក់ ដើម្បីមើលប្រវត្តិប្រតិបត្តិការពេញលេញរបស់គេ។',
          'បន្ថែមសមាជិកថ្មី នៅពេលនរណាម្នាក់មិនទាន់មាននៅក្នុងបញ្ជី។',
        ],
      },
      banks: {
        title: 'គណនីធនាគារ និងឥណទានហាង',
        intro: 'លុយស្ថិតនៅក្នុងគណនីធនាគារ និងឥណទានហាង។ ការរក្សាឱ្យត្រឹមត្រូវ ធ្វើឱ្យចំនួនសរុបរបស់អ្នកគួរឱ្យទុកចិត្ត។',
        steps: [
          'បើក «ធនាគារ» ដើម្បីមើលគណនីនីមួយៗ និងសមតុល្យបច្ចុប្បន្នរបស់វា។',
          'នៅពេលប្រតិបត្តិការប្រើធនាគារ សូមជ្រើសឱ្យត្រូវ ដើម្បីឱ្យសមតុល្យនៅត្រឹមត្រូវ។',
          'ឥណទានហាងគ្របដណ្តប់លើចំនួនមិនទាន់ដក — ប្រើវានៅពេលប្រតិបត្តិការដកពីឥណទាន មិនមែនពីធនាគារ។',
        ],
      },
      shifts: {
        title: 'វេនការងារ និងថ្ងៃឈប់សម្រាក',
        intro: 'តាមដានអ្នកណាកំពុងធ្វើការ ហើយរៀបចំថ្ងៃឈប់សម្រាក ដើម្បីឱ្យកាលវិភាគច្បាស់លាស់។',
        steps: [
          'ជ្រើសថ្ងៃមួយនៅលើប្រតិទិន។',
          'ចុច «រៀបចំថ្ងៃឈប់សម្រាក» ដើម្បីកក់ពេលឈប់។',
          'កំណត់ត្រាបង្ហាញអ្នកណាឈប់ថ្ងៃនេះ និងថ្ងៃខាងមុខ។',
        ],
      },
      team: {
        title: 'ការគ្រប់គ្រងក្រុមរបស់អ្នក',
        intro: 'អ្នកគ្រប់គ្រង និងប្រធាន បង្កើត និងគ្រប់គ្រងគណនីនៅក្រោមខ្លួន នៅលើផ្ទាំងបញ្ជា។',
        steps: [
          'នៅ «ក្រុម និងគណនី» បំពេញទម្រង់ដើម្បីបង្កើតគណនី។ ប្រធានអាចបន្ថែមអ្នកគ្រប់គ្រង និងបុគ្គលិក រីឯអ្នកគ្រប់គ្រងអាចបន្ថែមបុគ្គលិក។',
          'គណនីថ្មីនីមួយៗទទួលបានពាក្យសម្ងាត់បណ្ដោះអាសន្ន — ប្រាប់គេ ហើយគេនឹងប្ដូរវានៅពេលចូលលើកដំបូង។',
          'ប្រើឧបករណ៍បញ្ជានៅជួរនីមួយៗ ដើម្បីផ្អាក កែ ឬលុបគណនីដែលអ្នកគ្រប់គ្រង។',
        ],
      },
      roles: {
        title: 'តួនាទី និងការកំណត់ក្រុមហ៊ុន (ប្រធាន)',
        intro: 'ប្រធានមានសិទ្ធិទូលំទូលាយបំផុត៖ អ្នកគ្រប់គ្រង បុគ្គលិក តួនាទី និងការកំណត់មួយចំនួនទូទាំងក្រុមហ៊ុន។',
        steps: [
          'ផ្លាស់ប្ដូរតួនាទីរបស់នរណាម្នាក់ពីបញ្ជីក្រុម នៅពេលទំនួលខុសត្រូវរបស់គេផ្លាស់ប្ដូរ។',
          'កំណត់ស្លាកសញ្ញាក្រុមហ៊ុន ដើម្បីឱ្យវាបង្ហាញនៅទូទាំងកម្មវិធីសម្រាប់មនុស្សគ្រប់គ្នា។',
          'កំណត់តំបន់ពេលវេលាក្រុមហ៊ុន ដើម្បីឱ្យកាលបរិច្ឆេទ និងពេលវេលាត្រូវនឹងកន្លែងដែលអ្នកធ្វើការ។',
        ],
      },
    },
  },
};
