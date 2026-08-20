-- Ejecutado automáticamente por el entrypoint de la imagen de Postgres al
-- crear la base de datos por primera vez. Habilita pgvector; los esquemas
-- `brain` (Fase 1) y `runner` (Fase 2) se crean más adelante vía migraciones
-- propias de cada app, no aquí.
create extension if not exists vector;
