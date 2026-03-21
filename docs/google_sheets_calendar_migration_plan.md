# План миграции: Airtable -> Google Sheets + Google Calendar

## 1) Цель
Перенести ведение учеников и календарь занятий из Airtable в Google-стек без потери текущей логики:
- студенты/профили,
- календарь уроков,
- двусторонний sync с Supabase,
- ручные правки методиста (даты, статус, урок, комментарии),
- автопересчет плана при пропусках.

## 2) Рекомендуемая архитектура (MVP+)
1. **Google Spreadsheet (1 файл)**
- `Students` (профили)
- `Student_Calendar` (уроки)
- `Sync_Log` (журнал синка)
- `Lookups` (справочники: статусы, уровни, цвета)

2. **Google Calendar**
- Один основной календарь `AP Students - Lessons` (рекомендуется для простоты поддержки).
- Событие = 1 урок.
- Цвет события по статусу (`planned/completed/missed/rescheduled`).
- В `description` события: `supabase_lesson_id`, уровень, заметка приоритета, email ученика.

3. **Sync-сервис (Node + Supabase + Google APIs)**
- `pull_google_to_supabase` (изменения методиста -> Supabase)
- `push_supabase_to_google` (план/пересчеты -> Sheets/Calendar)
- Conflict guard: не перезаписывать свежие ручные правки Google N минут.
- Идемпотентность по ключу `supabase_lesson_id`.

## 3) Модель данных в Google

### Sheet: `Students`
- `student_user_id`
- `email` (unique)
- `student_name`
- `phone`
- `current_level`
- `target_level`
- `is_active`
- `updated_at`

### Sheet: `Student_Calendar`
- `supabase_lesson_id` (unique)
- `student_user_id`
- `email`
- `student_name`
- `lesson_date`
- `lesson_start_time`
- `duration_min` (60)
- `status`
- `level`
- `lesson_title`
- `lesson_description`
- `cost`
- `priority_note`
- `last_modified_at_google`
- `last_sync_at`

## 4) Правила синка

### Push (Supabase -> Google)
- Upsert `Students` по `email`.
- Upsert `Student_Calendar` по `supabase_lesson_id`.
- Upsert Calendar event по `supabase_lesson_id` (extended properties/description).
- Если `last_modified_at_google` свежее guard-окна (например 10 минут) -> запись пропускается в push.

### Pull (Google -> Supabase)
- Если методист поменял `status/date/title/description/level/cost/priority_note` -> `admin-update-lessons` в Supabase.
- `missed` -> перенос занятия и пересчет плана/остатка.
- Все ручные изменения логируются в `admin_audit_logs`.

## 5) Скрипты, которые я подготовлю на этапе реализации миграции
1. `scripts/google/bootstrap_google_schema.mjs`
- Создает/проверяет tabs, header row, data validation, conditional format.

2. `scripts/google/sync_supabase_to_google.mjs`
- Читает из Supabase и пушит в Sheets + Calendar.

3. `scripts/google/sync_google_to_supabase.mjs`
- Читает изменения методиста из Sheets/Calendar и применяет в Supabase.

4. `scripts/google/full_reconcile.mjs`
- Ночной reconcile для выравнивания расхождений.

5. `scripts/google/healthcheck.mjs`
- Проверка API-доступов, структуры, дельт синка, конфликтов.

## 6) Какие доступы нужны от вас

### Google
1. Google-аккаунт/Workspace, где будет храниться таблица и календарь.
2. **Editor** на Spreadsheet и Calendar (лучше owner на время настройки).
3. Разрешение на создание Apps Script/Cloud Project.
4. Включенные API в GCP:
- Google Sheets API
- Google Calendar API
- Google Drive API
5. Один из вариантов авторизации:
- **Service Account** (рекомендуется для серверного sync), или
- OAuth client (если нужен интерактивный доступ под вашим юзером).

### Supabase
1. `SUPABASE_PROJECT_REF`
2. `SUPABASE_SECRET` (service role)
3. Права на deploy edge/cron, если запускать по расписанию в Supabase.

### Инфра
1. Где крутить sync (Supabase cron / VPS / GitHub Actions).
2. Секрет-хранилище для ключей (`GOOGLE_SERVICE_ACCOUNT_JSON`, `SUPABASE_SECRET`).

## 7) План работ по шагам
1. Подготовка Google структуры (таблица + календарь + валидации).
2. Одноразовый начальный push из Supabase в Google.
3. Запуск двустороннего sync в режиме dry-run.
4. Включение write-mode + guard 10 минут + аудит.
5. Наблюдение 48 часов (метрики дельт/конфликтов).
6. Отключение Airtable-sync и финальный cutover.

## 8) Критерии готовности
- Все ученики и уроки видны в Google.
- Ручные изменения методиста доходят в Supabase.
- Пересчеты плана корректно возвращаются в Google.
- Нет дублей событий/уроков.
- Идемпотентный повторный sync без регрессий.
