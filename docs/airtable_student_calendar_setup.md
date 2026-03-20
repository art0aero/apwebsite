# Airtable setup for student calendar sync

## Recommended structure (better than one sheet per student)

Use one base with normalized tables:

1. `Students`
- One row per student.
- Core fields: `email` (unique), `student_name`, `phone`, `supabase_user_id` (optional), `is_active`.

2. `Student Calendar`
- One row per lesson event (not one sheet per student).
- Core fields (minimum):
  - `supabase_lesson_id` (single line text, unique key from Supabase)
  - `email`
  - `lesson_date`
  - `status` (`planned|completed|missed|rescheduled`)
- Recommended extra fields:
  - `student_name`, `phone`
  - `lesson_title`, `lesson_description`
  - `level`, `cost`, `priority_note`
  - `last_modified_at` (formula/last modified time field)

3. `Attendance Log` (optional)
- Audit trail for manual operations in Airtable.

## Why this model

- Airtable recommends separate connected entities in separate tables with links.
- For schedule UX, Calendar + Timeline/Interface views are easier to scale than creating a separate table per student.

## UI recommendation for methodists

Inside Airtable Interface:

1. Main dashboard page:
- Student picker.
- KPI blocks: next lesson, missed lessons, plan finish date.

2. Calendar page:
- Calendar view filtered by selected student.
- Color by `status` and badge for `priority_note`.

3. Timeline page:
- Timeline grouped by `status` for quick shifts and backlog visibility.

## Sync behavior implemented in this project

`supabase/functions/sync-attendance-airtable/index.ts` now supports:

1. Pull (Airtable -> Supabase)
- Reads attendance and lesson edits from Airtable.
- Applies updates to `study_lessons` (`date/title/description/status/level/cost/priority_note` where provided).
- If status is `missed`, marks lesson as missed and appends rescheduled lesson.
- Recalculates plan totals and remaining cost after changes.

2. Push (Supabase -> Airtable, optional)
- Controlled by `AIRTABLE_ENABLE_PUSH=true`.
- Upserts lessons from Supabase into `Student Calendar` by `supabase_lesson_id`.
- Optional upsert of student profile data into `Students` table.

## Required env vars

- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_STUDENTS_TABLE_NAME` (e.g. `Students`)
- `AIRTABLE_CALENDAR_TABLE_NAME` (e.g. `Student Calendar`)
- `AIRTABLE_ENABLE_PUSH=true`

## Optional env vars

- `AIRTABLE_STUDENTS_TABLE_NAME`
- `AIRTABLE_VIEW_NAME`
- `AIRTABLE_ENABLE_PUSH=true|false`
- `AIRTABLE_PUSH_GUARD_MINUTES` (default `10`)
- `AIRTABLE_EMAIL_FIELD` (default `email`)
- `AIRTABLE_STATUS_FIELD` (default `status`)
- `AIRTABLE_DATE_FIELD` (default `lesson_date`)
- `AIRTABLE_LESSON_ID_FIELD` (default `supabase_lesson_id`)
- `AIRTABLE_TITLE_FIELD` (default `lesson_title`)
- `AIRTABLE_DESCRIPTION_FIELD` (default `lesson_description`)
- `AIRTABLE_LEVEL_FIELD` (default `level`)
- `AIRTABLE_COST_FIELD` (default `cost`)
- `AIRTABLE_PRIORITY_FIELD` (default `priority_note`)
- `AIRTABLE_FULL_NAME_FIELD` (default `student_name`)
- `AIRTABLE_PHONE_FIELD` (default `phone`)
- `AIRTABLE_LAST_MODIFIED_FIELD` (default `last_modified_at`)
- `SYNC_CRON_SECRET` (for secure cron execution)

## Operational notes

- Use cron every 15 minutes for automatic convergence.
- Methodists can run manual sync from the admin panel button `Sync Airtable`.
- Safe mode: pull -> apply -> push with 10-minute guard for fresh Airtable edits.
- Interactive calendar in student dashboard updates automatically after sync, because it reads from Supabase `study_lessons`.
