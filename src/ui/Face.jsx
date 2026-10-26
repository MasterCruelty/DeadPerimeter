// Small portrait (render/portrait.js) with CRT scanlines: the radio log
// speakers and the soldiers in the command center.
import { useRef, useEffect } from 'react';
import { DPR } from '../constants.js';
import { portraitCanvas } from '../render/portrait.js';

export default function Face({ who, size = 26, title }) {
  const ref = useRef(null);
  const px = Math.round(size * DPR);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, px, px);
    g.drawImage(portraitCanvas(who, px), 0, 0);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < px; y += Math.max(2, Math.round(2 * DPR))) g.fillRect(0, y, px, 1);
  }, [who, px]);
  return <canvas ref={ref} width={px} height={px} title={title} style={{ width: size, height: size, border: '1px solid #3a4a30', flex: 'none' }} />;
}
