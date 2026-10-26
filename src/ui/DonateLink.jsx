// Link to the author's PayPal, on the title and victory screens.
import { t } from '../i18n/index.js';

export const DONATE_URL = 'https://paypal.me/mastercruelty';

export default function DonateLink() {
  return (
    <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" title="paypal.me/mastercruelty"
      style={{
        display: 'inline-block', background: '#2a2410', border: '1px solid #7a6420', color: '#e8c860',
        padding: '5px 12px', fontFamily: 'inherit', fontSize: '11px', textDecoration: 'none', letterSpacing: '.04em',
      }}>
      {t('🍺 Buy me a beer')}
    </a>
  );
}
