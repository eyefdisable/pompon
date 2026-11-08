/** Отображение расчёта: известная сумма отдельно от позиций «по фото». */
import React from 'react';
import { formatUAH, type Quote } from '../shared/pricing';

export function QuoteView({ q, compact = false }: { q: Quote; compact?: boolean }) {
  return (
    <div className="quote">
      {!compact && <ul className="quote-lines">{q.lines.map((l) => (
        <li key={l.key}><span>{l.title}{l.qty > 1 ? ` × ${l.qty}` : ''}{l.options.length > 0 && <small className="muted"> · {l.options.join(', ')}</small>}</span>
          <b className={l.manual ? 'manual' : ''}>{l.manual ? 'по фото' : formatUAH(l.sum!)}</b></li>))}</ul>}
      {q.minApplied && <p className="quote-note">Минимальный заказ на чистку — {formatUAH(q.minOrder)}; сумма поднята до минимума.</p>}
      {q.travelFee > 0 && <div className="quote-row"><span>Выезд за город</span><b>+{formatUAH(q.travelFee)}</b></div>}
      {q.complete ? <div className="quote-total"><span>Предварительно</span><strong>{formatUAH(q.knownTotal)}</strong></div>
        : <div className="quote-total partial"><span>Известная часть{q.knownTotal ? '' : ' пока нет'}</span><strong>{q.knownTotal ? formatUAH(q.knownTotal) : '—'}</strong>
            <em>+ {q.manualCount} {q.manualCount === 1 ? 'предмет' : 'предм.'} по фото — стоимость сообщим после оценки (итог чистки не меньше {formatUAH(q.minOrder)})</em></div>}
    </div>
  );
}

