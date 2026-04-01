-- Performance indexes for dashboard and timeline reads.

create index if not exists test_results_user_completed_at_desc_idx
  on public.test_results (user_id, completed_at desc);

create index if not exists study_plan_versions_goal_version_desc_idx
  on public.study_plan_versions (goal_id, version_no desc);

create index if not exists plan_checkpoints_plan_version_scheduled_date_idx
  on public.plan_checkpoints (plan_version_id, scheduled_date);
