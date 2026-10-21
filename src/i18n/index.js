// Game languages. English is the source: every on-screen string is
// written in English in the code and passed through t(), which returns
// the translation for the current language (or the English text when
// a translation is missing, so nothing ever shows blank).
//
//   t('LAUNCH SORTIE')                 → 'LANCIA LA SORTITA'
//   t('Wave {n}/{max}', { n, max })    → 'Ondata 3/30'
//
// Translate at display time only: data values that double as ids
// (location names in saves, boss names keying their looks...) stay in
// English. The language is remembered per browser; the first launch
// follows the browser's language.
import IT from './it/index.js';

export const LANGS = [
  { id: 'en', label: 'English', flag: '🇬🇧', speech: 'en' },
  { id: 'it', label: 'Italiano', flag: '🇮🇹', speech: 'it' },
];
const DICTS = { it: IT };
const KEY = 'dp-lang';

function initial() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && LANGS.some(l => l.id === v)) return v;
  } catch { /* storage blocked */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')).toLowerCase();
  return nav.startsWith('it') ? 'it' : 'en';
}

let lang = initial();
const listeners = new Set();

export const getLang = () => lang;
export const speechLang = () => (LANGS.find(l => l.id === lang) || LANGS[0]).speech;

export function setLang(id) {
  if (!LANGS.some(l => l.id === id) || id === lang) return;
  lang = id;
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  if (typeof document !== 'undefined') document.documentElement.lang = id;
  listeners.forEach(f => f(id));
}
export function onLangChange(f) { listeners.add(f); return () => listeners.delete(f); }

const fill = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? p[k] : m)) : s);
export const fillParams = (s, p) => (s ? fill(s, p) : s);

export function t(s, params) {
  if (s === null || s === undefined) return s;
  const d = DICTS[lang];
  return fill((d && d[s]) || s, params);
}
// Translation only if one exists (null otherwise) — for speech, which
// falls back to the English line and an English voice.
export function tIfAny(s, params) {
  const d = DICTS[lang];
  return d && d[s] ? fill(d[s], params) : null;
}
