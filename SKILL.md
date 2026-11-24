---
name: luka-social-ops
description: Use a user's Luka account API for social account diagnosis, topic analysis, content planning, image generation, and keyword monitoring. Use when work should execute through Luka; do not use for publishing content or editing the Luka codebase.
---

# Luka Social Ops

Use the bundled CLI to perform social-media work through the user's own Luka
account and workspace. The API key determines the workspace; never pass a
workspace ID.

## Setup

The user must create a key in Luka at **开放 API / Developer API** and set it as
`LUKA_API_KEY` in the environment. Never ask the user to paste the key into the
conversation, write it into a file, or include it in an artifact.

The default API base is `https://shizongziao.cn/api/v1`. For a self-hosted Luka
instance, set `LUKA_API_BASE_URL` or pass `--base-url`.

Start every session with:

```bash
node scripts/luka-api.mjs doctor
```

Use the returned billing balance and capabilities to decide what can run. If the
key is missing, guide the user through key creation instead of using browser
session cookies or automation.

## Operating Rules

- Read-only operations may run directly.
- Before any operation with a credit cost, state the capability, requested
  action, and exact credit cost. Run it with `--confirm` only after the user
  explicitly approves that action.
- Account connection or sync costs 10 credits, account diagnosis 10, content
  planning 20, topic analysis 30, keyword monitoring run 5, and image generation
  4.
- Confirm the exact monitor ID before deletion. Deletes require `--confirm` even
  though they do not cost credits.
- Do not retry a charged POST after a timeout or uncertain result. First query
  the returned job ID. If the create request itself timed out before returning an
  ID, ask the user before creating another job.
- Do not publish content, operate EveryPublish, or automate a social platform.
  This skill has no publishing capability.
- Do not print or expose Authorization headers, API keys, or raw environment
  values. The CLI reports API errors as JSON without the secret.

Read [references/api-v1.md](references/api-v1.md) when you need endpoint fields,
supported values, error handling, or recovery details.

## Common Workflows

### Diagnose an account

Avoid paying to connect the same account repeatedly:

```bash
node scripts/luka-api.mjs accounts find "https://www.xiaohongshu.com/user/profile/..."
```

If it is absent, explain that connection costs 10 credits and obtain approval,
then run:

```bash
node scripts/luka-api.mjs accounts connect "https://www.xiaohongshu.com/user/profile/..." \
  --platform xiaohongshu --confirm
```

Use the returned `accountSync.account.id`. Explain the additional 10-credit
diagnosis cost, obtain approval, and run:

```bash
node scripts/luka-api.mjs accounts diagnose ACCOUNT_ID --confirm
```

### Research topics

Create the asynchronous job, then wait without creating a second job:

```bash
node scripts/luka-api.mjs topics create \
  --account-url "https://www.xiaohongshu.com/user/profile/..." \
  --platform xiaohongshu --goal "涨粉" --content-format image_text_note --confirm

node scripts/luka-api.mjs topics wait JOB_ID --output ./output/topic-result.json
```

`topics wait` returns a compact candidate summary and stores the full result in
the output file. Add `--full` only when the full response is needed in context.
Polling is read-only.

### Create an image

First inspect live provider models and supported ratios:

```bash
node scripts/luka-api.mjs images models
```

After approval, create the job and wait or download:

```bash
node scripts/luka-api.mjs images create \
  --prompt "..." --size 4:5 --purpose "小红书封面" --confirm

node scripts/luka-api.mjs images wait JOB_ID --output ./output/cover.png
```

Use only the ratios returned by `images models`. Image content requires the same
API key, so download it through the CLI rather than opening the content path
directly.

### Plan content and monitor keywords

```bash
node scripts/luka-api.mjs content plan \
  --topic "..." --platform xiaohongshu --audience "..." --goal "..." --confirm

node scripts/luka-api.mjs monitors create "人工智能工具" --platform xiaohongshu
node scripts/luka-api.mjs monitors run MONITOR_ID --confirm
node scripts/luka-api.mjs monitors results MONITOR_ID
```

Creating a monitor is free; running it costs 5 credits.

## Errors

- `missing_api_key` or `invalid_api_key`: stop and help with key setup.
- `insufficient_credits`: stop and report the required cost; do not retry.
- `rate_limit_exceeded`: wait before retrying read-only calls.
- `capability_not_ready`: stop and explain which upstream capability is not
  configured.
- `confirmation_required`: show the action and cost, ask for approval, then rerun
  with `--confirm`.
- `request_timeout`: preserve any known job ID and query it instead of starting a
  duplicate charged job.

For all other commands, run `node scripts/luka-api.mjs --help`.
