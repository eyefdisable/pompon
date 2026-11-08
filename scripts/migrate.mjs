// Применяет db/schema.sql (идемпотентно). Использует собранный сервер.
process.env.MIGRATE_ONLY = '1';
await import('../dist/server.js');
