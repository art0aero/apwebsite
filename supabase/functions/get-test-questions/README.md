# get-test-questions Edge Function

Returns a randomized set of test questions for the authenticated user.

## Request

```json
{
  "count": 50,
  "test_id": "english-placement",
  "mode": "placement",
  "target_level": "B2"
}
```

## Response

```json
{
  "questions": [
    {
      "id": 101,
      "level": "B1",
      "question": "...",
      "options": ["...", "...", "...", "..."]
    }
  ],
  "count": 50,
  "cycle_reset": false,
  "total_question_bank": 500,
  "unseen_before_request": 240,
  "test_id": "english-placement",
  "mode": "placement",
  "target_level": "B2"
}
```

`cycle_reset=true` means all unseen questions were exhausted for this user and the seen-question set was reset before filling the request.

## Deploy

```bash
supabase functions deploy get-test-questions
```
