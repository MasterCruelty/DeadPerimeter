// Radio log in the command center: the last lines heard on the net
// (audio/radio.js), each with the speaker's portrait. Shows the latest
// few; the toggle opens the rest.
import { useState } from 'react';
import { C } from '../constants.js';
import { radioLog, speakerInfo } from '../audio/radio.js';
import Face from './Face.jsx';
import { t } from '../i18n/index.js';

export default function RadioLog() {
  const [open, setOpen] = useState(false);
  const log = radioLog();
  if (!log.length) return null;
  const rows = open ? log : log.slice(0, 4);
  return (
    <div style={{ marginTop: '8px', background: 'rgba(8,14,8,0.7)', border: `1px solid ${C.uib}`, padding: '6px 10px', fontSize: '9px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#9ad0ff', fontWeight: 'bold', letterSpacing: '.05em' }}>{t('📻 RADIO LOG')}</span>
        {log.length > 4 && (
          <button onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', color: C.txt, opacity: 0.7, cursor: 'pointer', fontFamily: 'inherit', fontSize: '9px' }}>
            {open ? t('▴ latest only') : t('▾ all {n}', { n: log.length })}
          </button>
        )}
      </div>
      {rows.map(e => {
        const sp = speakerInfo(e);
        return (
          <div key={e.when + e.line} style={{ display: 'flex', gap: '7px', alignItems: 'center', marginTop: '4px' }}>
            <Face who={e.who} />
            <div style={{ lineHeight: '1.4' }}>
              <b style={{ color: sp.color }}>{sp.name}</b>
              <span style={{ color: C.txt, marginLeft: '6px' }}>{t(e.line, e.params)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
