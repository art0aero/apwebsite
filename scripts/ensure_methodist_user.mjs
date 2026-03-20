const projectRef = process.env.SUPABASE_PROJECT_REF;
const serviceKey = process.env.SUPABASE_SECRET;
const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';

if (!projectRef || !serviceKey) {
  console.error('Missing env vars: SUPABASE_PROJECT_REF and SUPABASE_SECRET');
  process.exit(1);
}

const email = String(process.argv[2] || 'art.timokhin@gmail.com').trim().toLowerCase();
const password = String(process.argv[3] || 'mt64056405').trim();

if (!email || !password) {
  console.error('Usage: node scripts/ensure_methodist_user.mjs <email> <password>');
  process.exit(1);
}

const baseUrl = `https://${projectRef}.supabase.co`;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

function authHeaders(contentType = true) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  if (contentType) headers['Content-Type'] = 'application/json';
  return headers;
}

async function findUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetchJson(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=100`, {
      headers: authHeaders(false),
    });
    if (!res.ok) throw new Error(`list users failed (${res.status}): ${JSON.stringify(res.body)}`);
    const users = Array.isArray(res.body?.users) ? res.body.users : [];
    const found = users.find((user) => String(user.email || '').toLowerCase() === targetEmail);
    if (found) return found;
    if (users.length < 100) break;
  }
  return null;
}

async function createUser(targetEmail, targetPassword) {
  const res = await fetchJson(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      email: targetEmail,
      password: targetPassword,
      email_confirm: true,
    }),
  });

  if (!res.ok) throw new Error(`create user failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body?.user || res.body;
}

async function updateUser(userId, targetEmail, targetPassword) {
  const res = await fetchJson(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify({
      email: targetEmail,
      password: targetPassword,
      email_confirm: true,
    }),
  });

  if (!res.ok) throw new Error(`update user failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body?.user || res.body;
}

async function upsertRole(userId, targetEmail) {
  const res = await fetchJson(`${baseUrl}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      ...authHeaders(true),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      user_id: userId,
      email: targetEmail,
      role: 'methodist',
      allowlisted: true,
    }),
  });

  if (!res.ok) throw new Error(`upsert role failed (${res.status}): ${JSON.stringify(res.body)}`);
  return Array.isArray(res.body) ? res.body[0] : res.body;
}

async function verifySignIn(targetEmail, targetPassword) {
  const res = await fetchJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: targetEmail,
      password: targetPassword,
    }),
  });

  if (!res.ok || !res.body?.access_token) {
    throw new Error(`sign in verification failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
}

async function main() {
  let user = await findUserByEmail(email);
  if (!user) {
    user = await createUser(email, password);
    console.log(`Created user: ${user.id}`);
  } else {
    user = await updateUser(user.id, email, password);
    console.log(`Updated user password: ${user.id}`);
  }

  const role = await upsertRole(user.id, email);
  await verifySignIn(email, password);

  console.log('Methodist role configured and verified.');
  console.log(JSON.stringify({
    user_id: user.id,
    email,
    role: role?.role || 'methodist',
    allowlisted: Boolean(role?.allowlisted),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
