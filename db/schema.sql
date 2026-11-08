-- Помпон: схема PostgreSQL (16+). Применяется идемпотентно командой `npm run db:migrate`.
CREATE TABLE IF NOT EXISTS settings (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_account (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash  text NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash  text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);

CREATE TABLE IF NOT EXISTS orders (
  id               serial PRIMARY KEY,
  number           text UNIQUE NOT NULL,             -- человекочитаемый номер, НЕ даёт доступа
  token_hash       text UNIQUE NOT NULL,             -- sha256 от приватного токена клиента
  idempotency_key  text UNIQUE NOT NULL,
  payload_hash     text NOT NULL,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','agreed','done','cancelled')),
  client           jsonb NOT NULL,                   -- имя, телефон, адрес, пожелания, согласие
  items            jsonb NOT NULL,                   -- состав на момент отправки
  quote            jsonb NOT NULL,                   -- предварительный расчёт сервера
  pricing_snapshot jsonb NOT NULL,                   -- прайс на момент отправки
  final_price      int,
  agreed_at        text,                             -- 'YYYY-MM-DDTHH:MM' по местному времени компании
  owner_note       text NOT NULL DEFAULT '',         -- приватно, только в кабинете
  game             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS order_events (
  id         serial PRIMARY KEY,
  order_id   int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL,                          -- client | owner | system
  kind       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, at);

CREATE TABLE IF NOT EXISTS photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_hash  text NOT NULL,                         -- sha256 черновика: прикрепить может только тот же браузер
  order_id    int REFERENCES orders(id) ON DELETE CASCADE,
  mime        text NOT NULL,
  width       int NOT NULL,
  height      int NOT NULL,
  size        int NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_order_idx ON photos (order_id);
CREATE INDEX IF NOT EXISTS photos_orphan_idx ON photos (created_at) WHERE order_id IS NULL;

CREATE TABLE IF NOT EXISTS bonus_codes (
  id          serial PRIMARY KEY,
  order_id    int UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,  -- один код на заявку
  code        text UNIQUE NOT NULL,
  amount      int NOT NULL,
  min_order   int NOT NULL,
  expires_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','void')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  hits          int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
