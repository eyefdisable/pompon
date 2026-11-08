/** Обёртка 3D-сцены: загрузка, ошибка с повтором, постер без WebGL, реплика у персонажа, сброс ракурса. */
import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Stage, webglAvailable } from './three/engine';
import { CATEGORY_IDS, PHRASES, type CategoryId, type Characters } from '../shared/config';
import { Poster } from '../shared/poster';
import { prefersReducedMotion, isDark } from './lib';

export interface StageHandle { stage: Stage | null }
interface Props {
  category: CategoryId; characters: Characters; label: string;
  game?: boolean; mode?: 'rotate' | 'clean'; onProgress?(p: number): void; onReady?(): void;
  caption?: React.ReactNode; version?: string;
}

export const Stage3D = forwardRef<StageHandle, Props>(function Stage3D(p, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'nowebgl'>(() => (typeof window !== 'undefined' && !webglAvailable() ? 'nowebgl' : 'loading'));
  const [attempt, setAttempt] = useState(0);
  const [phrase, setPhrase] = useState('');
  const phraseIdx = useRef(0);
  const anchor = useRef({ x: 0, y: 0, eyesY: 0, visible: false });
  const phraseRef = useRef('');
  phraseRef.current = phrase;

  useImperativeHandle(ref, () => ({ get stage() { return stageRef.current; } }), []);

  useEffect(() => {
    if (state === 'nowebgl' || !canvas.current) return;
    const st = new Stage(canvas.current, { faces: p.characters.faces, reducedMotion: prefersReducedMotion() }, {
      onError: (kind) => setState(kind === 'nowebgl' ? 'nowebgl' : 'error'),
      onReady: () => { setState('ready'); p.onReady?.(); },
      onProgress: (v) => p.onProgress?.(v),
      onAnchor: (a) => { anchor.current = a; placeBubble(); }
    });
    if (!st.init()) return;
    stageRef.current = st;
    st.setDark(!!isDark());
    const onTheme = () => st.setDark(!!isDark());
    window.addEventListener('pp-theme', onTheme);
    // готовим все модели заранее: переключение категорий без ожидания
    st.show(p.category);
    st.preload(CATEGORY_IDS, '/models/', p.version).catch(() => {});
    return () => { window.removeEventListener('pp-theme', onTheme); st.destroy(); stageRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, state === 'nowebgl']);

  useEffect(() => { stageRef.current?.show(p.category); }, [p.category]);
  useEffect(() => { stageRef.current?.setOptions({ faces: p.characters.faces }); }, [p.characters.faces]);
  useEffect(() => { if (stageRef.current) stageRef.current.mode = p.mode ?? 'rotate'; }, [p.mode]);

  // реплика: заранее написанные фразы, меняются по категории; скрываются через 6 с
  useEffect(() => {
    if (!p.characters.phrases || !p.characters.faces || p.game) { setPhrase(''); return; }
    const list = PHRASES[p.characters.preset][p.category];
    phraseIdx.current = (phraseIdx.current + 1) % list.length;
    setPhrase(list[phraseIdx.current % list.length]);
  }, [p.category, p.characters.preset, p.characters.phrases, p.characters.faces, p.game]);
  useEffect(() => { if (!phrase) return; const t = setTimeout(() => setPhrase(''), 6500); return () => clearTimeout(t); }, [phrase]);
  useEffect(() => { placeBubble(); });

  function placeBubble() {
    const b = bubble.current, w = wrap.current; if (!b || !w) return;
    const a = anchor.current; const W = w.clientWidth, H = w.clientHeight;
    if (!a.visible || !phraseRef.current) { b.dataset.show = '0'; return; }
    const bw = b.offsetWidth, bh = b.offsetHeight, m = 10;
    let x = a.x - bw / 2, y = a.y - bh - 6, side = false;
    y = Math.min(y, a.eyesY - 34 - bh);              // не закрываем глаза
    if (y < m) { side = true; x = a.x + 70; y = Math.max(m, a.eyesY - bh - 40); if (x + bw > W - m) x = a.x - 70 - bw; }
    x = Math.max(m, Math.min(W - bw - m, x)); y = Math.max(m, Math.min(H - bh - 72, y)); // не залезаем на кнопки внизу
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    b.dataset.side = side ? '1' : '0'; b.dataset.show = '1';
    const tail = Math.max(14, Math.min(bw - 14, a.x - x)); b.style.setProperty('--tail', tail + 'px');
  }

  const fallback = state === 'nowebgl' || state === 'error';
  return (
    <div className="stage-box">
    <div className={`stage${p.game ? ' stage-game' : ''}${p.mode === 'clean' ? ' is-clean' : ''}`} ref={wrap} data-state={state}>
      <canvas key={attempt} ref={canvas} tabIndex={0} aria-label={`3D-модель: ${p.label}. Перетащите, чтобы повернуть; стрелки — поворот, 0 — сброс.`} hidden={fallback} />
      {state === 'loading' && <div className="stage-overlay"><Poster category={p.category} /><span className="spinner" aria-hidden="true" /><span className="sr-only">Загружаем 3D-модель…</span></div>}
      {fallback && (
        <div className="stage-overlay stage-fallback">
          <Poster category={p.category} title={p.label} />
          <p className="muted small">{state === 'nowebgl' ? '3D недоступно на этом устройстве — показываем иллюстрацию. Заказ работает как обычно.' : 'Не удалось загрузить 3D-модель.'}</p>
          {state === 'error' && <button className="btn btn-small" type="button" onClick={() => { setState('loading'); setAttempt((a) => a + 1); }}>Повторить</button>}
        </div>
      )}
      <div className="bubble" ref={bubble} data-show="0" role="status" aria-live="polite">{phrase}</div>
      {!fallback && (
        <div className="stage-tools">
          <button className="chip" type="button" onClick={() => stageRef.current?.resetView()} aria-label="Сбросить ракурс">↺ Ракурс</button>
          {!p.game && p.characters.faces && <button className="chip" type="button" onClick={() => { stageRef.current?.greet(); const list = PHRASES[p.characters.preset][p.category]; phraseIdx.current++; if (p.characters.phrases) setPhrase(list[phraseIdx.current % list.length]); }}>👋 Привет</button>}
        </div>
      )}
    </div>
    {p.caption && <p className="stage-caption">{p.caption}</p>}
    </div>
  );
});
