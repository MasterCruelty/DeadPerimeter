// Language selector: a pill per language, the current one lit. Used on
// the title screen and in the command center bar.
import { LANGS, getLang, setLang } from '../i18n/index.js';

export default function LangSelect({ compact = false }) {
  const cur = getLang();
  return (
    <div role="radiogroup" aria-label="Language" style={{ display: 'inline-flex', border: '1px solid #3a4a30', borderRadius: '3px', overflow: 'hidden' }}>
      {LANGS.map(l => {
        const on = l.id === cur;
        return (
          <button key={l.id} role="radio" aria-checked={on} onClick={() => setLang(l.id)} title={l.label}
            style={{
              background: on ? '#2e4a1e' : '#11180c', color: on ? '#d8f0c0' : '#7a8a70',
              border: 'none', borderRight: '1px solid #3a4a30', padding: compact ? '4px 8px' : '5px 12px',
              cursor: on ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '11px', letterSpacing: '.04em',
              fontWeight: on ? 'bold' : 'normal',
            }}>
            {l.flag} {compact ? l.id.toUpperCase() : l.label}
          </button>
        );
      })}
    </div>
  );
}
