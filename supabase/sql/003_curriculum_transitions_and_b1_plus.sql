-- Goal-level manual B1 boost toggle
alter table if exists public.study_goals
  add column if not exists b1_plus_enabled boolean not null default false;

-- Curriculum transition model (A0->A1, A1->A2, ... + optional B1+ track)
alter table if exists public.study_curriculum
  add column if not exists path_from text;

alter table if exists public.study_curriculum
  add column if not exists path_to text;

alter table if exists public.study_curriculum
  add column if not exists track text not null default 'core';

alter table if exists public.study_curriculum
  add column if not exists unit_code text;

alter table if exists public.study_curriculum
  add column if not exists source_file text;

-- Legacy backfill for existing level-based rows
update public.study_curriculum
set path_from = case level
  when 'A1' then 'A0'
  when 'A2' then 'A1'
  when 'B1' then 'A2'
  when 'B2' then 'B1'
  when 'C1' then 'B2'
  when 'C2' then 'C1'
  else 'A1'
end
where path_from is null;

update public.study_curriculum
set path_to = level
where path_to is null;

update public.study_curriculum
set track = 'core'
where track is null;

alter table public.study_curriculum
  alter column path_from set not null;

alter table public.study_curriculum
  alter column path_to set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_curriculum_path_from_check'
  ) then
    alter table public.study_curriculum
      add constraint study_curriculum_path_from_check
      check (path_from in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_curriculum_path_to_check'
  ) then
    alter table public.study_curriculum
      add constraint study_curriculum_path_to_check
      check (path_to in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_curriculum_track_check'
  ) then
    alter table public.study_curriculum
      add constraint study_curriculum_track_check
      check (track in ('core', 'b1_plus'));
  end if;
end $$;

drop index if exists public.study_curriculum_level_ordinal_uidx;

create unique index if not exists study_curriculum_transition_track_ordinal_uidx
  on public.study_curriculum (path_from, path_to, track, ordinal);

create index if not exists study_curriculum_transition_active_idx
  on public.study_curriculum (is_active, path_from, path_to, track, ordinal);
