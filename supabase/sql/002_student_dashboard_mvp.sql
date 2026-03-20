create extension if not exists pgcrypto;

-- Catalog of tests (scales beyond single placement test)
create table if not exists public.test_catalog (
  id text primary key,
  title text not null,
  subtitle text not null,
  description text not null,
  question_count int not null default 50 check (question_count > 0),
  duration_minutes int not null default 40 check (duration_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.test_catalog (id, title, subtitle, description, question_count, duration_minutes, is_active)
values (
  'english-placement',
  'Тест на уровень владения английским языком',
  'Пройди и узнай свой уровень моментально',
  'Стартовый диагностический тест на уровни A1-C2',
  50,
  40,
  true
)
on conflict (id) do update
set
  title = excluded.title,
  subtitle = excluded.subtitle,
  description = excluded.description,
  question_count = excluded.question_count,
  duration_minutes = excluded.duration_minutes,
  is_active = excluded.is_active;

-- Student profile completeness gate (soft-gated in UI)
create table if not exists public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone_e164 text,
  is_completed boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists student_profiles_email_idx on public.student_profiles (lower(email));

-- Optional curriculum/tariff source (filled from your table later)
create table if not exists public.study_curriculum (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  ordinal int not null check (ordinal >= 0),
  title text not null,
  description text not null,
  estimated_lessons int not null default 1 check (estimated_lessons > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists study_curriculum_level_ordinal_uidx
  on public.study_curriculum (level, ordinal);

create table if not exists public.study_tariffs (
  level text primary key check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  price_per_lesson numeric(10,2) not null check (price_per_lesson >= 0),
  currency text not null default 'RUB',
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.study_tariffs (level, price_per_lesson, currency)
values
  ('A1', 1500, 'RUB'),
  ('A2', 1600, 'RUB'),
  ('B1', 1700, 'RUB'),
  ('B2', 1800, 'RUB'),
  ('C1', 2000, 'RUB'),
  ('C2', 2200, 'RUB')
on conflict (level) do nothing;

-- Goals, versioned plans, lessons
create table if not exists public.study_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  current_level text not null,
  target_level text not null check (target_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  lessons_per_week int not null check (lessons_per_week between 1 and 7),
  preferred_days int[] not null check (cardinality(preferred_days) between 1 and 7),
  is_active boolean not null default true,
  active_plan_version_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists study_goals_user_active_idx on public.study_goals (user_id, is_active);

create table if not exists public.study_plan_versions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.study_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_no int not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  start_date date not null,
  end_date date not null,
  total_lessons int not null check (total_lessons >= 0),
  completed_lessons int not null default 0 check (completed_lessons >= 0),
  total_cost numeric(12,2) not null default 0,
  remaining_cost numeric(12,2) not null default 0,
  delta_cost numeric(12,2) not null default 0,
  delta_days int not null default 0,
  source_attempt_id uuid,
  change_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  confirmed_at timestamptz,
  unique (goal_id, version_no)
);

create index if not exists study_plan_versions_goal_status_idx
  on public.study_plan_versions (goal_id, status);

create table if not exists public.study_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.study_goals(id) on delete cascade,
  plan_version_id uuid not null references public.study_plan_versions(id) on delete cascade,
  lesson_index int not null,
  lesson_date date not null,
  level text not null,
  title text not null,
  description text not null,
  status text not null default 'planned' check (status in ('planned', 'completed', 'missed', 'rescheduled')),
  cost numeric(10,2) not null default 0,
  is_checkpoint boolean not null default false,
  checkpoint_level text,
  is_final_test boolean not null default false,
  priority_note text,
  attendance_source text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists study_lessons_plan_index_uidx
  on public.study_lessons (plan_version_id, lesson_index);

create index if not exists study_lessons_user_date_idx
  on public.study_lessons (user_id, lesson_date);

create table if not exists public.plan_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.study_goals(id) on delete cascade,
  plan_version_id uuid not null references public.study_plan_versions(id) on delete cascade,
  checkpoint_type text not null check (checkpoint_type in ('level_retest', 'final_test')),
  expected_level text,
  scheduled_date date not null,
  completed_at timestamptz,
  result_level text,
  badge_issued boolean not null default false,
  certificate_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

-- Attendance integration (Airtable + manual)
create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  student_email text not null,
  lesson_id uuid references public.study_lessons(id) on delete set null,
  event_type text not null check (event_type in ('present', 'missed', 'rescheduled')),
  source text not null default 'airtable',
  dedupe_key text not null unique,
  raw_payload jsonb,
  event_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists attendance_events_email_idx
  on public.attendance_events (lower(student_email), event_at desc);

-- Per-attempt per-question rows for AI + admin review
create table if not exists public.attempt_items (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  test_id text not null,
  mode text not null,
  target_level text,
  question_id bigint not null references public.question_bank(id) on delete restrict,
  question_text text not null,
  question_level text not null,
  selected_option smallint not null,
  selected_option_text text not null,
  correct_option smallint not null,
  correct_option_text text not null,
  is_correct boolean not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists attempt_items_attempt_idx on public.attempt_items (attempt_id);
create index if not exists attempt_items_user_idx on public.attempt_items (user_id, created_at desc);

-- AI insights
create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid,
  plan_version_id uuid references public.study_plan_versions(id) on delete set null,
  source text not null check (source in ('openai', 'fallback')),
  summary text not null,
  items jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_insights_user_idx on public.ai_insights (user_id, created_at desc);

-- Certificates (badge + final)
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.study_goals(id) on delete set null,
  plan_version_id uuid references public.study_plan_versions(id) on delete set null,
  level text not null,
  certificate_type text not null check (certificate_type in ('badge', 'final')),
  status text not null default 'issued' check (status in ('issued', 'revoked')),
  verify_token text not null unique,
  pdf_url text,
  metadata jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default timezone('utc', now())
);

create index if not exists certificates_user_idx on public.certificates (user_id, issued_at desc);

-- Roles for methodist/admin access
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('student', 'methodist', 'admin')),
  allowlisted boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_roles_role_allowlist_idx
  on public.user_roles (role, allowlisted);

-- Replan rate limit by Moscow date
create table if not exists public.replan_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_msk date not null,
  usage_count int not null default 0 check (usage_count >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, date_msk)
);

-- Audit log for admin actions
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_email text not null,
  student_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_audit_logs_actor_idx
  on public.admin_audit_logs (actor_user_id, created_at desc);

-- Extend existing test_results in backward-compatible way
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'test_results'
  ) then
    alter table public.test_results add column if not exists attempt_id uuid;
    alter table public.test_results add column if not exists test_id text default 'english-placement';
    alter table public.test_results add column if not exists mode text default 'placement';
    alter table public.test_results add column if not exists target_level text;
    alter table public.test_results add column if not exists is_checkpoint boolean default false;
    alter table public.test_results add column if not exists is_final_test boolean default false;

    create unique index if not exists test_results_attempt_id_uidx
      on public.test_results (attempt_id)
      where attempt_id is not null;
  end if;
end
$$;

-- RLS
alter table public.test_catalog enable row level security;
alter table public.student_profiles enable row level security;
alter table public.study_curriculum enable row level security;
alter table public.study_tariffs enable row level security;
alter table public.study_goals enable row level security;
alter table public.study_plan_versions enable row level security;
alter table public.study_lessons enable row level security;
alter table public.plan_checkpoints enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attempt_items enable row level security;
alter table public.ai_insights enable row level security;
alter table public.certificates enable row level security;
alter table public.user_roles enable row level security;
alter table public.replan_usage_daily enable row level security;
alter table public.admin_audit_logs enable row level security;

-- Student read own rows
create policy if not exists "Students can read active test catalog"
  on public.test_catalog
  for select
  to authenticated
  using (is_active = true);

create policy if not exists "Students can manage own profile"
  on public.student_profiles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists "Students can read curriculum"
  on public.study_curriculum
  for select
  to authenticated
  using (is_active = true);

create policy if not exists "Students can read tariffs"
  on public.study_tariffs
  for select
  to authenticated
  using (true);

create policy if not exists "Students can read own goals"
  on public.study_goals
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own plan versions"
  on public.study_plan_versions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own lessons"
  on public.study_lessons
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own checkpoints"
  on public.plan_checkpoints
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own attendance"
  on public.attendance_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own attempt items"
  on public.attempt_items
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own ai insights"
  on public.ai_insights
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own certificates"
  on public.certificates
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Students can read own replan usage"
  on public.replan_usage_daily
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Certificate verification is served via Edge Function using service role.

-- Roles table visibility for own row
create policy if not exists "Users can read own role"
  on public.user_roles
  for select
  to authenticated
  using (auth.uid() = user_id);
