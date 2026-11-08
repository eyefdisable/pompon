/** Плоский постер предмета — показывается до загрузки 3D и вместо него, если WebGL недоступен. */
import React from 'react';
import type { CategoryId } from './config';

const F = 'var(--fabric, #C9C3B5)', D = 'var(--fabric-dark, #A79F8E)', L = 'var(--leg, #2B2F2E)';

function Face({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="-14" cy="0" rx="7" ry="8.5" fill="#fff" /><ellipse cx="14" cy="0" rx="7" ry="8.5" fill="#fff" />
      <circle cx="-13" cy="1.5" r="3.6" fill="#1d2120" /><circle cx="15" cy="1.5" r="3.6" fill="#1d2120" />
      <path d="M-9 14 q9 7 18 0" stroke="#1d2120" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

export function Poster({ category, title }: { category: CategoryId; title?: string }) {
  const shapes: Record<CategoryId, React.ReactNode> = {
    sofa: <>
      <rect x="40" y="70" width="240" height="70" rx="18" fill={D} />
      {[0, 1, 2].map((i) => <rect key={i} x={62 + i * 66} y="44" width="62" height="56" rx="14" fill={F} />)}
      {[0, 1, 2].map((i) => <rect key={'s' + i} x={60 + i * 68} y="104" width="66" height="26" rx="10" fill={F} />)}
      <rect x="28" y="66" width="34" height="80" rx="16" fill={F} /><rect x="258" y="66" width="34" height="80" rx="16" fill={F} />
      <rect x="64" y="146" width="8" height="18" rx="3" fill={L} /><rect x="248" y="146" width="8" height="18" rx="3" fill={L} />
      <Face x={160} y={70} /></>,
    armchair: <>
      <rect x="100" y="76" width="120" height="66" rx="18" fill={D} />
      <rect x="118" y="38" width="84" height="66" rx="16" fill={F} /><rect x="116" y="104" width="88" height="28" rx="10" fill={F} />
      <rect x="88" y="66" width="34" height="80" rx="16" fill={F} /><rect x="198" y="66" width="34" height="80" rx="16" fill={F} />
      <rect x="110" y="146" width="8" height="18" rx="3" fill={L} /><rect x="202" y="146" width="8" height="18" rx="3" fill={L} />
      <Face x={160} y={68} /></>,
    mattress: <>
      <rect x="40" y="92" width="240" height="56" rx="14" fill={F} />
      <rect x="40" y="96" width="240" height="6" fill={D} /><rect x="40" y="138" width="240" height="6" fill={D} />
      {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={68 + i * 37} cy="94" r="3" fill={D} />)}
      <rect x="130" y="128" width="60" height="8" rx="4" fill={D} />
      <Face x={160} y={116} /></>,
    chair: <>
      <rect x="118" y="30" width="84" height="74" rx="14" fill={F} />
      <rect x="110" y="104" width="100" height="22" rx="9" fill={F} />
      <rect x="120" y="126" width="7" height="44" rx="3" fill={L} /><rect x="193" y="126" width="7" height="44" rx="3" fill={L} />
      <Face x={160} y={64} /></>,
    other: <>
      <ellipse cx="160" cy="150" rx="110" ry="14" fill={D} opacity=".5" />
      <ellipse cx="160" cy="110" rx="70" ry="44" fill={F} /><ellipse cx="160" cy="80" rx="66" ry="14" fill={D} />
      <Face x={160} y={108} /></>
  };
  return (
    <svg className="poster" viewBox="0 0 320 190" role="img" aria-label={title ?? 'Иллюстрация предмета'}>
      <ellipse cx="160" cy="170" rx="130" ry="10" fill="currentColor" opacity=".08" />
      {shapes[category]}
    </svg>
  );
}
