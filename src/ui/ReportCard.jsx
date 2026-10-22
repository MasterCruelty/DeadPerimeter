// After-action report block: grade letter + stats grid, with the record
// line under it. Used by the sortie result, the command center (last
// wave) and the victory screen (vaccine finale).
import { C } from '../constants.js';
import { GRADE_COL, reportRows } from '../expedition/report.js';
import { t } from '../i18n/index.js';

export default function ReportCard({ rep, title, record, compact = false }) {
  if (!rep) return null;
  const col = GRADE_COL[rep.grade] || C.txt;
  const rows = reportRows(rep);
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', background: 'rgba(6,12,6,0.9)', border: `1px solid ${C.uib}`, padding: compact ? '6px 10px' : '8px 12px', marginTop: '8px', textAlign: 'left' }}>
      <div style={{ minWidth: compact ? '44px' : '62px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: `1px solid ${C.uib}`, paddingRight: '10px' }}>
        <span style={{ fontSize: '8px', color: C.txt, opacity: 0.6, letterSpacing: '.08em' }}>{t('GRADE')}</span>
        <span style={{ fontSize: compact ? '26px' : '40px', fontWeight: 'bold', color: col, lineHeight: 1, textShadow: `0 0 12px ${col}55` }}>{rep.grade}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontSize: '10px', color: C.acc, fontWeight: 'bold', letterSpacing: '.06em', marginBottom: '4px' }}>{title}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: '2px 12px' }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', fontSize: '10px', lineHeight: '1.6' }}>
              <span style={{ color: C.txt, opacity: 0.65, whiteSpace: 'nowrap' }}>{label}</span>
              <b style={{ color: C.txt, whiteSpace: 'nowrap' }}>{value}</b>
            </div>
          ))}
        </div>
        {record && record.isNew && (
          <div style={{ fontSize: '11px', color: '#ffd54a', fontWeight: 'bold', marginTop: '4px', letterSpacing: '.08em' }}>
            {record.best
              ? t('★ NEW RECORD — was {g} · {s}', { g: record.best.grade, s: record.best.score })
              : t('★ NEW RECORD')}
          </div>
        )}
        {record && !record.isNew && record.best && (
          <div style={{ fontSize: '10px', color: C.txt, opacity: 0.7, marginTop: '4px' }}>
            {t('Best here: {g} · {s}', { g: record.best.grade, s: record.best.score })}
          </div>
        )}
      </div>
    </div>
  );
}
