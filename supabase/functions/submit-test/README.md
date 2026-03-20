# submit-test Edge Function

Server-side grading and saving of test results using `question_bank` as the source of truth.

## Expected request body

```json
{
  "answers": [{ "question_id": 1, "selected_option": 2 }],
  "time_seconds": 523,
  "test_id": "english-placement",
  "mode": "placement",
  "target_level": "B2",
  "client_meta": {
    "timezone": "Europe/Moscow",
    "user_agent": "..."
  }
}
```

## Response body

```json
{
  "attempt_id": "uuid",
  "score": 74,
  "normalized_score": 0.51,
  "level": "B2",
  "level_badge": "B2 - Upper-Intermediate",
  "breakdown": { "A1": 100, "A2": 88, "B1": 75, "B2": 62, "C1": 37, "C2": 25 },
  "completed_at": "2026-03-18T15:20:00.000Z",
  "test_id": "english-placement",
  "mode": "placement",
  "target_level": "B2"
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

It expects exactly 50 answers per submission and writes seen questions into `user_seen_questions`.
