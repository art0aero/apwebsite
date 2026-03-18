# submit-test Edge Function

Server-side grading and saving of test results.

## Expected request body

```json
{
  "answers": [{ "question_id": 1, "selected_option": 2 }],
  "time_seconds": 523,
  "client_meta": {
    "timezone": "Europe/Moscow",
    "user_agent": "..."
  }
}
```

## Response body

```json
{
  "score": 74,
  "normalized_score": 0.51,
  "level": "B2",
  "level_badge": "B2 - Upper-Intermediate",
  "breakdown": { "A1": 100, "A2": 88, "B1": 75, "B2": 62, "C1": 37, "C2": 25 },
  "completed_at": "2026-03-18T15:20:00.000Z"
}
```

## Deploy

```bash
supabase functions deploy submit-test
```

This function uses env vars from Supabase project:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
