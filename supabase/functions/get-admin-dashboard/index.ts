import { CORS_HEADERS, ensureMethodistAccess, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';

type Payload = {
  student_user_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    await ensureMethodistAccess(adminClient, user.id, user.email);

    const payload = req.method === 'POST' ? await parseJson<Payload>(req) : {};

    const [profilesRes, goalsRes, plansRes, testsRes] = await Promise.all([
      adminClient
        .from('student_profiles')
        .select('user_id,email,full_name,phone_e164,is_completed,updated_at')
        .order('updated_at', { ascending: false })
        .limit(1000),
      adminClient
        .from('study_goals')
        .select('id,user_id,current_level,target_level,lessons_per_week,preferred_days,b1_plus_enabled,is_active,active_plan_version_id,updated_at')
        .eq('is_active', true),
      adminClient
        .from('study_plan_versions')
        .select('id,user_id,goal_id,status,start_date,end_date,total_lessons,completed_lessons,total_cost,remaining_cost')
        .eq('status', 'active'),
      adminClient
        .from('test_results')
        .select('user_id,user_email,attempt_id,level,score,completed_at,time_seconds,level_badge,test_id,mode,target_level')
        .order('completed_at', { ascending: false })
        .limit(5000),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (goalsRes.error) throw new Error(goalsRes.error.message);
    if (plansRes.error) throw new Error(plansRes.error.message);
    if (testsRes.error) throw new Error(testsRes.error.message);

    const latestTestByUser = new Map<string, Record<string, unknown>>();
    for (const row of testsRes.data || []) {
      const uid = String(row.user_id || '');
      if (!uid || latestTestByUser.has(uid)) continue;
      latestTestByUser.set(uid, row);
    }

    const goalByUser = new Map<string, Record<string, unknown>>();
    for (const goal of goalsRes.data || []) {
      goalByUser.set(String(goal.user_id), goal);
    }

    const planByUser = new Map<string, Record<string, unknown>>();
    for (const plan of plansRes.data || []) {
      planByUser.set(String(plan.user_id), plan);
    }

    const profileUserIds = new Set((profilesRes.data || []).map((profile) => String(profile.user_id)));

    const students = (profilesRes.data || []).map((profile) => {
      const uid = String(profile.user_id);
      return {
        profile,
        goal: goalByUser.get(uid) || null,
        active_plan: planByUser.get(uid) || null,
        latest_test: latestTestByUser.get(uid) || null,
      };
    });

    for (const [uid, latestTest] of latestTestByUser.entries()) {
      if (profileUserIds.has(uid)) continue;
      students.push({
        profile: {
          user_id: uid,
          email: String(latestTest.user_email || ''),
          full_name: null,
          phone_e164: null,
          is_completed: false,
          updated_at: latestTest.completed_at || null,
        },
        goal: goalByUser.get(uid) || null,
        active_plan: planByUser.get(uid) || null,
        latest_test: latestTest,
      });
    }

    let selectedStudent: Record<string, unknown> | null = null;
    if (payload.student_user_id) {
      const studentId = String(payload.student_user_id);
      const [attemptsRes, lessonsRes, insightsRes] = await Promise.all([
        adminClient
          .from('test_results')
          .select('*')
          .eq('user_id', studentId)
          .order('completed_at', { ascending: false })
          .limit(50),
        adminClient
          .from('study_lessons')
          .select('*')
          .eq('user_id', studentId)
          .order('lesson_date', { ascending: true })
          .limit(500),
        adminClient
          .from('ai_insights')
          .select('*')
          .eq('user_id', studentId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (attemptsRes.error) throw new Error(attemptsRes.error.message);
      if (lessonsRes.error) throw new Error(lessonsRes.error.message);
      if (insightsRes.error) throw new Error(insightsRes.error.message);

      selectedStudent = {
        attempts: attemptsRes.data || [],
        lessons: lessonsRes.data || [],
        insights: insightsRes.data || [],
      };
    }

    return jsonResponse({
      admin: {
        user_id: user.id,
        email: user.email,
      },
      students,
      selected_student: selectedStudent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.startsWith('Forbidden') ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
