# Luka Open API v1 reference

Base URL: `https://shizongziao.cn/api/v1`

Authentication:

```http
Authorization: Bearer <LUKA_API_KEY>
```

The key resolves the user and workspace. Sending any workspace override is a
validation error.

## Credit and confirmation rules

| Capability | Credit cost |
|---|---:|
| Content planning | 20 |
| Topic analysis | 30 |
| Account connection or sync | 10 |
| Account diagnosis | 10 |
| Keyword monitor run | 5 |
| Image generation | 4 per image |
| Reads, task polling, image download | 0 |

The CLI requires `--confirm` for charged operations and for monitor deletion.
Do not bypass this gate.

## Identity

### `GET /me`

Returns:

- User and workspace IDs.
- API key name, prefix, and last four characters.
- Billing environment, available credits, reserved credits, and plan.
- Capability availability and live credit prices.

Use this before paid work. `image_generation.available` means the provider is
configured; `GET /images/models` performs the live model lookup.

CLI:

```bash
node scripts/luka-api.mjs doctor
```

## Accounts

### `GET /accounts`

Optional query:

- `accountUrl`: matches a saved profile URL or its stable profile path.
- `limit`: 1–100, default 50.

Returns `accounts[]`, `count`, and applied `filters`.

CLI:

```bash
node scripts/luka-api.mjs accounts list
node scripts/luka-api.mjs accounts find "https://www.xiaohongshu.com/user/profile/..."
```

### `GET /accounts/:id`

Returns the saved account details. This is free and requires the account to
belong to the key's workspace.

### `POST /accounts/connect`

Request:

```json
{
  "accountUrl": "https://www.xiaohongshu.com/user/profile/...",
  "platform": "xiaohongshu"
}
```

`accountUrl` is required. `platform` can be inferred from a recognized URL.
The response includes:

```json
{
  "accountSync": {
    "account": {
      "id": "account-id",
      "platform": "xiaohongshu",
      "displayName": "name",
      "notesCount": 30
    },
    "notesFetched": 30,
    "notesSaved": 30,
    "pagesFetched": 2,
    "stoppedReason": "target_notes_reached"
  }
}
```

Use `accountSync.account.id` for diagnosis and later syncs. A successful call
costs 10 credits.

### `POST /accounts/:id/sync`

Request body uses the same `accountUrl` and optional `platform` fields. It
updates the account and recent content. Costs 10 credits.

### `POST /accounts/:id/diagnoses`

Request body: `{}`.

The account must already be saved. Costs 10 credits. The diagnosis is generated
from the workspace's saved account and content data.

## Content planning

### `POST /content-plans`

Request:

```json
{
  "topic": "开发者 API 接入指南",
  "platform": "xiaohongshu",
  "contentType": "image_text_note",
  "goal": "获取注册",
  "audience": "独立开发者",
  "keywords": ["API", "自动化"]
}
```

`topic` is required. `keywords` accepts at most 8 values. Costs 20 credits.

The response contains `contentPlan.outline`, `hooks`, `talkingPoints`, `risks`,
`modelId`, and billing details.

## Topic analysis

### `POST /topic-jobs`

Request:

```json
{
  "source_type": "account_url",
  "account_url": "https://www.xiaohongshu.com/user/profile/...",
  "platform": "xiaohongshu",
  "content_format": "image_text_note",
  "content_goal": "涨粉",
  "keywords": ["开发者工具"],
  "max_candidates": 5,
  "user_requirement": "优先实操型选题"
}
```

Rules:

- `source_type` must be `account_url` or `saved_account`.
- `fixture` data is rejected by the production API.
- `account_url` is required for `account_url`.
- `account_id` is required for `saved_account`.
- `max_candidates` is clamped to 3–8.

The call returns HTTP 202 with a queued job and reserved billing. Costs 30
credits when the job succeeds. Poll the job; do not create another job just
because this request appears slow.

Job statuses: `queued`, `running`, `completed`, `failed`, `cancelled`.

### Read endpoints

- `GET /topic-jobs/:id`: job status, progress, and error.
- `GET /topic-jobs/:id/events`: workflow events.
- `GET /topic-jobs/:id/result`: candidates, frameworks, and creation spec.

CLI:

```bash
node scripts/luka-api.mjs topics create --account-url "..." --goal "涨粉" --confirm
node scripts/luka-api.mjs topics wait JOB_ID --output ./output/topic-result.json
```

`topics wait` polls until completion and automatically fetches the result. By
default it prints a compact candidate summary and writes the full result to
`--output` when supplied. Add `--full` only when the complete JSON is necessary
in context.

## Keyword monitors

### Create

`POST /keyword-monitors`

```json
{
  "keyword": "人工智能工具",
  "platform": "xiaohongshu"
}
```

Creating or reading monitors is free. Supported platforms come from the current
Luka keyword-search implementation; if a platform is unsupported, return the API
validation error without guessing.

### Run and read

- `POST /keyword-monitors/:id/runs`: executes a real platform search, 5 credits.
- `GET /keyword-monitors`: lists monitors.
- `GET /keyword-monitors/:id`: monitor state and latest summary.
- `GET /keyword-monitors/:id/results`: latest real search result.
- `DELETE /keyword-monitors/:id`: deletes the monitor and its results.

`DELETE` requires explicit confirmation because it is destructive.

## Images

### `GET /images/models`

Returns live provider models, supported ratios, `defaultModel`, and
`creditCost`.

Supported ratios:

- `1:1`
- `9:16`
- `16:9`
- `4:5`

### `POST /images/jobs`

Request:

```json
{
  "prompt": "A minimalist editorial social media cover, pale background",
  "size": "4:5",
  "model": "optional live model ID",
  "style": "optional style guidance",
  "purpose": "optional usage context"
}
```

`prompt` is required. The call returns HTTP 202 with a queued image job and 4
reserved credits. The final charge is settled only after generation succeeds.

Image job statuses: `queued`, `processing`, `succeeded`, `failed`.

### Read and download

- `GET /images/jobs/:id`: progress, model, dimensions, MIME type, errors, and
  `contentUrl`.
- `GET /images/jobs/:id/content`: authenticated binary image content.

The content endpoint is not public. Download it with the same Bearer key. The
CLI handles this:

```bash
node scripts/luka-api.mjs images wait JOB_ID --output ./output/image.png
node scripts/luka-api.mjs images download JOB_ID --output ./output/image.png
```

## Visual-note Skills and remote execution

The installed Luka Skill is a gateway to the platform's visual-note Skill
catalog. The catalog and execution remain remote; the public API does not expose
Skill prompts, scripts, or internal directories.

### `GET /visual-note/skills`

Optional query:

- `q`
- `category`
- `scene`
- `page`
- `pageSize`
- `sort=latest|popular|title`

Returns paginated Skill metadata, including `skillName`, title, description,
cover, category, scene, page policy, keywords, and usage count.

### `GET /visual-note/skills/recommendations?q=...`

Returns ranked visual-note Skills for a content brief. This is read-only and
does not generate anything.

### `GET /visual-note/skills/:id`

Returns one visual-note Skill.

### `POST /visual-note/jobs`

Selected Skill:

```json
{
  "mode": "selected",
  "skillId": "healing-space-xhs-note",
  "prompt": "为一间治愈系香氛店制作六页小红书图文笔记",
  "pageCount": 6,
  "platform": "xiaohongshu",
  "imageAspectRatio": "3:4"
}
```

Automatic selection:

```json
{
  "mode": "auto",
  "prompt": "为独立开发者制作一套 AI 工作流小红书图文，优先实操清单风格",
  "pageCount": 6,
  "platform": "xiaohongshu"
}
```

The API creates an asynchronous Luka assistant run. It returns HTTP 202 with a
visual-note job. The execution uses the platform's existing Skill runtime,
visual-note generator, image provider, QA, artifact storage, and assistant-run
billing.

Send `Idempotency-Key` or `clientRequestID` when retrying from a client that may
lose the first response.

### `GET /visual-note/jobs/:id`

Returns:

- `status`: queued, running, waiting_input, succeeded, failed, or cancelled.
- Selected Skill metadata.
- Result text and failure information.
- Delivery revision, note copy, hashtags, page copy, page status, quality, and
  content URLs.

Do not create another job while a valid job is running. Poll this endpoint.

### Page and bundle download

- `GET /visual-note/jobs/:id/pages/:pageID/content`
- `POST /visual-note/jobs/:id/bundles`
- `GET /visual-note/jobs/:id/bundles/:artifactID/content?revision=...`

The CLI `visual-notes download` handles all three and writes page images,
`note.json`, and the ZIP bundle.

CLI examples:

```bash
node scripts/luka-api.mjs visual-notes recommend --query "独立开发者 AI 工作流"
node scripts/luka-api.mjs visual-notes create --prompt "..." --skill-id SKILL_ID --confirm
node scripts/luka-api.mjs visual-notes wait JOB_ID --output-dir ./output/visual-note
```

Visual-note generation consumes credits through the existing Luka assistant run
and image billing. It is not free merely because it is invoked from an external
Agent.

## Errors and retries

Common API error codes:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_json` | Invalid JSON body |
| 401 | `missing_api_key`, `invalid_api_key`, `revoked_api_key` | Key problem |
| 402 | `insufficient_credits` | Insufficient workspace credits |
| 403 | `workspace_unavailable`, `api_access_unavailable` | Access problem |
| 404 | `resource_not_found` | Resource or route not found |
| 422 | `validation_error` | Invalid payload or workspace override |
| 429 | `rate_limit_exceeded` | Rate limit exceeded |
| 502 | `upstream_error` | Upstream service failed |
| 503 | `capability_not_ready` | Required provider is not configured |

Recovery rules:

- The CLI retries safe GET requests for `429`, `502`, and `503`.
- It does not retry charged POST requests.
- On a POST timeout with a known job ID, query the job.
- On a POST timeout without a job ID, ask before creating another charged job.
- For image and topic jobs, stop on terminal failure and report the returned
  error code and message.

## Advanced generic request

Use `request` only when the high-level command does not cover the needed
read-only field:

```bash
node scripts/luka-api.mjs request GET /accounts --query limit=20
```

For a charged request, supply the known cost and explicit confirmation:

```bash
node scripts/luka-api.mjs request POST /content-plans \
  --data-file payload.json --cost 20 --confirm
```

Do not use the generic command to reach publishing or browser automation. This
skill intentionally exposes no publishing workflow.
