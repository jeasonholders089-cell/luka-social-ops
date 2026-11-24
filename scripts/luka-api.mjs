#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://shizongziao.cn/api/v1';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE_WAIT_MS = 360_000;
const DEFAULT_TOPIC_WAIT_MS = 900_000;
const DEFAULT_POLL_MS = 3_000;
const MAX_RETRY_DELAY_MS = 15_000;

const HELP = `Luka Social Ops API client

Environment:
  LUKA_API_KEY       Required. Create it in Luka > Developer API.
  LUKA_API_BASE_URL  Optional. Defaults to ${DEFAULT_BASE_URL}.

Read-only:
  node scripts/luka-api.mjs doctor
  node scripts/luka-api.mjs accounts list [--account-url URL] [--limit 50]
  node scripts/luka-api.mjs accounts find ACCOUNT_URL
  node scripts/luka-api.mjs accounts get ACCOUNT_ID
  node scripts/luka-api.mjs content plan --data '{"topic":"...","platform":"xiaohongshu"}'
  node scripts/luka-api.mjs topics get JOB_ID
  node scripts/luka-api.mjs topics events JOB_ID
  node scripts/luka-api.mjs topics result JOB_ID
  node scripts/luka-api.mjs topics wait JOB_ID [--output topic-result.json] [--full]
  node scripts/luka-api.mjs monitors list
  node scripts/luka-api.mjs monitors get MONITOR_ID
  node scripts/luka-api.mjs monitors results MONITOR_ID
  node scripts/luka-api.mjs images models
  node scripts/luka-api.mjs images get JOB_ID
  node scripts/luka-api.mjs images wait JOB_ID [--output image.png]
  node scripts/luka-api.mjs images download JOB_ID --output image.png
  node scripts/luka-api.mjs visual-notes list [--query TEXT] [--category NAME]
  node scripts/luka-api.mjs visual-notes recommend --query TEXT
  node scripts/luka-api.mjs visual-notes get SKILL_ID
  node scripts/luka-api.mjs visual-notes wait JOB_ID [--output result.json]
  node scripts/luka-api.mjs visual-notes download JOB_ID --output-dir ./output/note

Paid or mutating (all require --confirm):
  node scripts/luka-api.mjs accounts connect ACCOUNT_URL [--platform xiaohongshu] --confirm
  node scripts/luka-api.mjs accounts sync ACCOUNT_ID --account-url ACCOUNT_URL --confirm
  node scripts/luka-api.mjs accounts diagnose ACCOUNT_ID --confirm
  node scripts/luka-api.mjs content plan --data '{"topic":"..."}' --confirm
  node scripts/luka-api.mjs topics create --account-url ACCOUNT_URL --goal 涨粉 --confirm
  node scripts/luka-api.mjs topics wait JOB_ID
  node scripts/luka-api.mjs monitors create KEYWORD --platform xiaohongshu
  node scripts/luka-api.mjs monitors run MONITOR_ID --confirm
  node scripts/luka-api.mjs monitors delete MONITOR_ID --confirm
  node scripts/luka-api.mjs images create --prompt "..." --size 4:5 --confirm
  node scripts/luka-api.mjs images wait JOB_ID --output image.png
  node scripts/luka-api.mjs visual-notes create --skill-id SKILL_ID --prompt "..." --confirm
  node scripts/luka-api.mjs visual-notes create --prompt "..." --confirm

Advanced:
  node scripts/luka-api.mjs request GET /accounts --query limit=20
  node scripts/luka-api.mjs request POST /content-plans --data-file payload.json --cost 20 --confirm
`;

class CliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}

const BOOLEAN_OPTIONS = new Set(['confirm', 'full', 'help', 'pretty']);
const REPEATED_OPTIONS = new Set(['query', 'keyword']);

function parseArgs(argv) {
  const positionals = [];
  const options = {
    query: [],
    keyword: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const raw = token.slice(2);
    if (!raw) throw new CliError('invalid_arguments', 'Invalid empty option.');
    const equalsIndex = raw.indexOf('=');
    const name = (equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw).trim();
    if (!name) throw new CliError('invalid_arguments', 'Invalid option name.');

    if (BOOLEAN_OPTIONS.has(name)) {
      if (equalsIndex >= 0) {
        throw new CliError('invalid_arguments', `--${name} does not accept a value.`);
      }
      options[name] = true;
      continue;
    }

    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1];
    if (value === undefined || (!equalsIndex && value.startsWith('--'))) {
      throw new CliError('invalid_arguments', `--${name} requires a value.`);
    }
    if (!equalsIndex) index += 1;

    if (REPEATED_OPTIONS.has(name)) {
      options[name].push(value);
    } else {
      options[name] = value;
    }
  }

  return { positionals, options };
}

function option(name, fallback = undefined) {
  const value = globalThis.__lukaOptions?.[name];
  return value === undefined ? fallback : value;
}

function firstOption(name, fallback = undefined) {
  const value = option(name);
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function requirePosition(positionals, index, label) {
  const value = String(positionals[index] || '').trim();
  if (!value) throw new CliError('invalid_arguments', `${label} is required.`);
  return value;
}

function parsePositiveInteger(raw, fallback, label) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError('invalid_arguments', `${label} must be a positive number.`);
  }
  return Math.floor(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig() {
  const apiKey = String(process.env.LUKA_API_KEY || '').trim();
  if (!apiKey) {
    throw new CliError(
      'missing_luka_api_key',
      'LUKA_API_KEY is not set. Create a key in Luka > Developer API, then set it as an environment variable. Do not paste the key into chat.',
    );
  }

  const baseUrl = String(
    option('base-url') || process.env.LUKA_API_BASE_URL || DEFAULT_BASE_URL,
  ).trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new CliError('invalid_luka_api_base_url', 'LUKA_API_BASE_URL must be a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new CliError('invalid_luka_api_base_url', 'LUKA_API_BASE_URL must use HTTP or HTTPS.');
  }
  return { apiKey, baseUrl, serviceOrigin: parsed.origin };
}

function buildUrl(config, apiPath, query = []) {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const url = new URL(`${config.baseUrl}${normalizedPath}`);
  for (const pair of query) {
    const separator = String(pair).indexOf('=');
    if (separator <= 0) {
      throw new CliError('invalid_arguments', `--query must use key=value syntax: ${pair}`);
    }
    const key = String(pair).slice(0, separator).trim();
    const value = String(pair).slice(separator + 1);
    if (key) url.searchParams.append(key, value);
  }
  return url;
}

function parseResponseJson(text, status) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('invalid_server_response', `Luka returned non-JSON data with HTTP ${status}.`, {
      preview: text.slice(0, 300),
    });
  }
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS);
  }
  return Math.min(1_000 * (2 ** attempt), MAX_RETRY_DELAY_MS);
}

async function fetchOnce(config, method, url, body, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new CliError('request_timeout', `Request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError('network_error', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function request(config, method, apiPath, input = {}) {
  const url = buildUrl(config, apiPath, input.query || []);
  const timeoutMs = parsePositiveInteger(
    input.timeoutMs ?? option('timeout-ms'),
    DEFAULT_TIMEOUT_MS,
    'timeout-ms',
  );
  const methodUpper = method.toUpperCase();
  const retryableMethod = methodUpper === 'GET' || methodUpper === 'HEAD';
  const maxAttempts = retryableMethod ? 3 : 1;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchOnce(config, methodUpper, url, input.body, timeoutMs, input.headers || {});
    const text = await response.text();
    const parsed = parseResponseJson(text, response.status);
    if (response.ok) {
      return {
        status: response.status,
        requestId: response.headers.get('x-request-id') || parsed?.requestId || null,
        body: parsed,
      };
    }

    const error = parsed?.error || {};
    const shouldRetry = retryableMethod
      && attempt + 1 < maxAttempts
      && (response.status === 429 || response.status === 502 || response.status === 503);
    if (shouldRetry) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    lastError = new CliError(
      String(error.code || `http_${response.status}`),
      String(error.message || `Luka API request failed with HTTP ${response.status}.`),
      {
        status: response.status,
        requestId: error.requestId || null,
        details: error.details ?? null,
      },
    );
    break;
  }

  throw lastError || new CliError('request_failed', 'Luka API request failed.');
}

async function requestBinary(config, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'image/*,application/octet-stream',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      const parsed = text.trim().startsWith('{') ? parseResponseJson(text, response.status) : null;
      const error = parsed?.error || {};
      throw new CliError(
        String(error.code || `http_${response.status}`),
        String(error.message || `Image download failed with HTTP ${response.status}.`),
        { status: response.status, requestId: error.requestId || null },
      );
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentDisposition: response.headers.get('content-disposition') || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new CliError('request_timeout', `Image download timed out after ${timeoutMs}ms.`);
    }
    if (error instanceof CliError) throw error;
    throw new CliError('network_error', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonInput() {
  const dataFile = option('data-file');
  const rawData = option('data');
  if (dataFile && rawData) {
    throw new CliError('invalid_arguments', 'Use either --data or --data-file, not both.');
  }
  if (dataFile) {
    const text = await readFile(path.resolve(String(dataFile)), 'utf8');
    return parseResponseJson(text, 0);
  }
  if (rawData !== undefined) return parseResponseJson(String(rawData), 0);
  return undefined;
}

function requireConfirmation(cost, label) {
  if (option('confirm')) return;
  throw new CliError(
    'confirmation_required',
    `${label} costs ${cost} Luka credit${cost === 1 ? '' : 's'}. Explain the cost to the user and rerun with --confirm only after explicit approval.`,
    { creditCost: cost },
  );
}

function requireMutationConfirmation(label) {
  if (option('confirm')) return;
  throw new CliError(
    'confirmation_required',
    `${label} changes Luka data. Confirm the exact target with the user and rerun with --confirm.`,
  );
}

function requireCreditAction(label, message) {
  if (option('confirm')) return;
  throw new CliError(
    'confirmation_required',
    `${label} ${message} State the expected consumption to the user and rerun with --confirm only after explicit approval.`,
  );
}

function dataOf(response) {
  return response.body?.data ?? response.body;
}

function emitSuccess(command, response, extra = {}) {
  const output = {
    ok: true,
    command,
    data: dataOf(response),
    httpStatus: response.status,
    requestId: response.requestId,
    ...extra,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function buildContentPlanBody() {
  const keywords = Array.isArray(option('keyword')) ? option('keyword') : [];
  return {
    topic: option('topic') || requirePosition(globalThis.__lukaPositionals, 2, 'topic or --data'),
    platform: option('platform') || null,
    contentType: option('content-type') || null,
    goal: option('goal') || null,
    audience: option('audience') || null,
    keywords,
  };
}

function buildTopicBody() {
  const keywords = Array.isArray(option('keyword')) ? option('keyword') : [];
  const accountUrl = option('account-url') || null;
  const accountId = option('account-id') || null;
  return {
    source_type: accountId ? 'saved_account' : 'account_url',
    platform: option('platform') || 'xiaohongshu',
    account_url: accountUrl || undefined,
    account_id: accountId || undefined,
    content_format: option('content-format') || 'image_text_note',
    content_goal: option('goal') || '涨粉',
    keywords,
    max_candidates: Number(option('max-candidates') || 5),
    user_requirement: option('requirement') || undefined,
  };
}

async function waitForTopic(config, jobId) {
  const timeoutMs = parsePositiveInteger(option('timeout-ms'), DEFAULT_TOPIC_WAIT_MS, 'timeout-ms');
  const pollMs = parsePositiveInteger(option('poll-ms'), DEFAULT_POLL_MS, 'poll-ms');
  const deadline = Date.now() + timeoutMs;
  let latest = null;

  while (Date.now() < deadline) {
    const response = await request(config, 'GET', `/topic-jobs/${encodeURIComponent(jobId)}`, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    latest = dataOf(response)?.job || dataOf(response);
    if (['completed', 'failed', 'cancelled'].includes(latest?.status)) {
      if (latest.status !== 'completed') {
        throw new CliError('topic_job_failed', latest?.error?.message || `Topic job ended with ${latest.status}.`, latest);
      }
      const resultResponse = await request(config, 'GET', `/topic-jobs/${encodeURIComponent(jobId)}/result`);
      return {
        job: latest,
        result: dataOf(resultResponse)?.result ?? dataOf(resultResponse),
      };
    }
    await sleep(pollMs);
  }

  throw new CliError('topic_wait_timeout', `Topic job did not finish within ${timeoutMs}ms.`, latest);
}

function compactTopicWaitResult(result) {
  const candidates = Array.isArray(result?.result?.candidates)
    ? result.result.candidates.map((candidate) => ({
      rank: candidate.rank_no,
      title: candidate.title,
      coreClaim: candidate.core_claim,
      score: candidate.score?.total ?? null,
    }))
    : [];
  return {
    job: {
      id: result?.job?.id,
      status: result?.job?.status,
      progress: result?.job?.progress,
      completedAt: result?.job?.completed_at,
    },
    candidates,
    resultKeys: result?.result && typeof result.result === 'object' ? Object.keys(result.result) : [],
  };
}

async function emitTopicWaitResult(result) {
  let outputPath = null;
  if (option('output')) {
    outputPath = path.resolve(String(option('output')));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  const payload = option('full')
    ? { ok: true, command: 'topics wait', data: result, ...(outputPath ? { outputPath } : {}) }
    : {
        ok: true,
        command: 'topics wait',
        data: compactTopicWaitResult(result),
        ...(outputPath ? { outputPath } : {}),
      };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function downloadImage(config, jobId, outputPath) {
  const jobResponse = await request(config, 'GET', `/images/jobs/${encodeURIComponent(jobId)}`);
  const job = dataOf(jobResponse)?.imageJob || dataOf(jobResponse);
  if (job?.status !== 'succeeded' || !job?.contentUrl) {
    throw new CliError('image_not_ready', 'Image job has not succeeded.', job);
  }

  const absoluteOutput = path.resolve(String(outputPath));
  const contentUrl = new URL(job.contentUrl, config.serviceOrigin).toString();
  const content = await requestBinary(
    config,
    contentUrl,
    parsePositiveInteger(option('timeout-ms'), DEFAULT_TIMEOUT_MS, 'timeout-ms'),
  );
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, content.bytes);
  return {
    job,
    outputPath: absoluteOutput,
    bytesWritten: content.bytes.byteLength,
    contentType: content.contentType,
  };
}

async function waitForImage(config, jobId) {
  const timeoutMs = parsePositiveInteger(option('timeout-ms'), DEFAULT_IMAGE_WAIT_MS, 'timeout-ms');
  const pollMs = parsePositiveInteger(option('poll-ms'), DEFAULT_POLL_MS, 'poll-ms');
  const deadline = Date.now() + timeoutMs;
  let latest = null;

  while (Date.now() < deadline) {
    const response = await request(config, 'GET', `/images/jobs/${encodeURIComponent(jobId)}`);
    latest = dataOf(response)?.imageJob || dataOf(response);
    if (latest?.status === 'succeeded') {
      const output = option('output');
      return {
        imageJob: latest,
        download: output ? await downloadImage(config, jobId, output) : null,
      };
    }
    if (latest?.status === 'failed') {
      throw new CliError(
        latest.errorCode || 'image_generation_failed',
        latest.errorMessage || 'Image generation failed.',
        latest,
      );
    }
    await sleep(pollMs);
  }

  throw new CliError('image_wait_timeout', `Image job did not finish within ${timeoutMs}ms.`, latest);
}

function visualNoteJobFromResponse(response) {
  return dataOf(response)?.visualNoteJob || dataOf(response);
}

async function waitForVisualNote(config, jobId) {
  const timeoutMs = parsePositiveInteger(option('timeout-ms'), DEFAULT_TOPIC_WAIT_MS, 'timeout-ms');
  const pollMs = parsePositiveInteger(option('poll-ms'), DEFAULT_POLL_MS, 'poll-ms');
  const deadline = Date.now() + timeoutMs;
  let latest = null;

  while (Date.now() < deadline) {
    const response = await request(config, 'GET', `/visual-note/jobs/${encodeURIComponent(jobId)}`);
    latest = visualNoteJobFromResponse(response);
    if (['succeeded', 'failed', 'cancelled', 'waiting_input'].includes(latest?.status)) {
      if (latest.status === 'waiting_input') {
        throw new CliError(
          'visual_note_requires_input',
          'The visual-note Skill needs more information before it can generate.',
          latest,
        );
      }
      if (latest.status !== 'succeeded') {
        throw new CliError(
          latest.errorCode || `visual_note_${latest.status}`,
          latest.errorMessage || `Visual-note job ended with ${latest.status}.`,
          latest,
        );
      }
      return latest;
    }
    await sleep(pollMs);
  }

  throw new CliError('visual_note_wait_timeout', `Visual-note job did not finish within ${timeoutMs}ms.`, latest);
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

async function downloadVisualNote(config, job, outputDir) {
  const directory = path.resolve(String(outputDir));
  await mkdir(directory, { recursive: true });
  const delivery = job.delivery;
  if (!delivery) throw new CliError('visual_note_not_ready', 'Visual-note delivery is not available.', job);

  const downloadedPages = [];
  for (const page of delivery.pages || []) {
    if (!page.contentUrl || page.status !== 'ready') continue;
    const url = new URL(page.contentUrl, config.serviceOrigin).toString();
    const content = await requestBinary(
      config,
      url,
      parsePositiveInteger(option('timeout-ms'), DEFAULT_TIMEOUT_MS, 'timeout-ms'),
    );
    const fileName = `page-${String(page.pageNumber).padStart(2, '0')}.${extensionForMimeType(content.contentType)}`;
    const outputPath = path.join(directory, fileName);
    await writeFile(outputPath, content.bytes);
    downloadedPages.push({
      pageNumber: page.pageNumber,
      outputPath,
      bytesWritten: content.bytes.byteLength,
      contentType: content.contentType,
    });
  }

  const notePath = path.join(directory, 'note.json');
  await writeFile(notePath, `${JSON.stringify({
    jobId: job.id,
    skill: job.skill,
    note: delivery.note,
    pages: delivery.pages,
    quality: delivery.quality,
  }, null, 2)}\n`, 'utf8');

  let bundle = null;
  if (delivery.bundle?.canRequest) {
    const bundleResponse = await request(config, 'POST', `/visual-note/jobs/${encodeURIComponent(job.id)}/bundles`, {
      body: {
        revision: delivery.revision,
        allowPartial: delivery.status !== 'complete',
      },
    });
    const descriptor = dataOf(bundleResponse)?.bundle || dataOf(bundleResponse);
    if (descriptor?.downloadUrl) {
      const content = await requestBinary(
        config,
        new URL(descriptor.downloadUrl, config.serviceOrigin).toString(),
        parsePositiveInteger(option('timeout-ms'), DEFAULT_TIMEOUT_MS, 'timeout-ms'),
      );
      const safeName = String(descriptor.fileName || 'visual-note.zip').replace(/[\\/:*?"<>|]+/g, '-');
      const bundlePath = path.join(directory, safeName);
      await writeFile(bundlePath, content.bytes);
      bundle = {
        outputPath: bundlePath,
        bytesWritten: content.bytes.byteLength,
        contentType: content.contentType,
        fileName: descriptor.fileName,
        partial: descriptor.partial,
      };
    }
  }

  return {
    jobId: job.id,
    outputDirectory: directory,
    pages: downloadedPages,
    notePath,
    bundle,
  };
}

function compactVisualNote(job) {
  return {
    id: job.id,
    status: job.status,
    skill: job.skill ? { id: job.skill.id, title: job.skill.title } : null,
    resultText: job.resultText,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    delivery: job.delivery ? {
      revision: job.delivery.revision,
      status: job.delivery.status,
      expectedCount: job.delivery.expectedCount,
      generatedCount: job.delivery.generatedCount,
      note: job.delivery.note,
      quality: job.delivery.quality,
      bundle: job.delivery.bundle,
      issues: job.delivery.issues,
      pages: job.delivery.pages.map((page) => ({
        id: page.id,
        pageNumber: page.pageNumber,
        name: page.name,
        role: page.role,
        status: page.status,
        contentUrl: page.contentUrl,
      })),
    } : null,
  };
}

async function emitVisualNoteJob(command, job, extra = {}) {
  let outputPath = null;
  if (option('output')) {
    outputPath = path.resolve(String(option('output')));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    command,
    data: compactVisualNote(job),
    ...extra,
    ...(outputPath ? { outputPath } : {}),
  }, null, 2)}\n`);
}

async function dispatch(config) {
  const positionals = globalThis.__lukaPositionals;
  const command = String(positionals[0] || '').toLowerCase();
  const subcommand = String(positionals[1] || '').toLowerCase();

  if (option('help') || !command || command === 'help') return { help: true };

  if (command === 'doctor' || command === 'me') {
    const response = await request(config, 'GET', '/me');
    emitSuccess('doctor', response);
    return { handled: true };
  }

  if (command === 'request') {
    const method = requirePosition(positionals, 1, 'HTTP method').toUpperCase();
    const apiPath = requirePosition(positionals, 2, 'API path');
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readJsonInput();
    const cost = Number(option('cost') || 0);
    if (Number.isFinite(cost) && cost > 0) requireConfirmation(cost, `Generic ${method} request`);
    if (method === 'DELETE') requireMutationConfirmation('Generic DELETE request');
    const response = await request(config, method, apiPath, {
      body,
      query: option('query'),
    });
    emitSuccess(`request ${method} ${apiPath}`, response);
    return { handled: true };
  }

  if (command === 'accounts') {
    if (subcommand === 'list' || subcommand === 'find') {
      const accountUrl = subcommand === 'find'
        ? requirePosition(positionals, 2, 'account URL')
        : option('account-url');
      const query = [];
      if (accountUrl) query.push(`accountUrl=${accountUrl}`);
      if (option('limit')) query.push(`limit=${option('limit')}`);
      const response = await request(config, 'GET', '/accounts', { query });
      emitSuccess(`accounts ${subcommand}`, response);
      return { handled: true };
    }
    if (subcommand === 'get') {
      const accountId = requirePosition(positionals, 2, 'account ID');
      const response = await request(config, 'GET', `/accounts/${encodeURIComponent(accountId)}`);
      emitSuccess('accounts get', response);
      return { handled: true };
    }
    if (subcommand === 'connect') {
      const accountUrl = requirePosition(positionals, 2, 'account URL');
      requireConfirmation(10, 'Account connection and sync');
      const response = await request(config, 'POST', '/accounts/connect', {
        body: {
          accountUrl,
          platform: option('platform') || undefined,
        },
        timeoutMs: option('timeout-ms') || 300_000,
      });
      emitSuccess('accounts connect', response);
      return { handled: true };
    }
    if (subcommand === 'sync') {
      const accountId = requirePosition(positionals, 2, 'account ID');
      const accountUrl = option('account-url');
      if (!accountUrl) throw new CliError('invalid_arguments', 'accounts sync requires --account-url.');
      requireConfirmation(10, 'Account sync');
      const response = await request(config, 'POST', `/accounts/${encodeURIComponent(accountId)}/sync`, {
        body: {
          accountUrl,
          platform: option('platform') || undefined,
          username: option('username') || undefined,
        },
        timeoutMs: option('timeout-ms') || 300_000,
      });
      emitSuccess('accounts sync', response);
      return { handled: true };
    }
    if (subcommand === 'diagnose') {
      const accountId = requirePosition(positionals, 2, 'account ID');
      requireConfirmation(10, 'Account diagnosis');
      const response = await request(config, 'POST', `/accounts/${encodeURIComponent(accountId)}/diagnoses`, {
        body: {},
        timeoutMs: option('timeout-ms') || 180_000,
      });
      emitSuccess('accounts diagnose', response);
      return { handled: true };
    }
  }

  if (command === 'content' && subcommand === 'plan') {
    requireConfirmation(20, 'Content planning');
    const body = (await readJsonInput()) || buildContentPlanBody();
    const response = await request(config, 'POST', '/content-plans', { body });
    emitSuccess('content plan', response);
    return { handled: true };
  }

  if (command === 'topics') {
    if (subcommand === 'create') {
      requireConfirmation(30, 'Topic analysis');
      const body = (await readJsonInput()) || buildTopicBody();
      const response = await request(config, 'POST', '/topic-jobs', { body });
      emitSuccess('topics create', response);
      return { handled: true };
    }
    if (subcommand === 'get') {
      const jobId = requirePosition(positionals, 2, 'topic job ID');
      const response = await request(config, 'GET', `/topic-jobs/${encodeURIComponent(jobId)}`);
      emitSuccess('topics get', response);
      return { handled: true };
    }
    if (subcommand === 'events') {
      const jobId = requirePosition(positionals, 2, 'topic job ID');
      const response = await request(config, 'GET', `/topic-jobs/${encodeURIComponent(jobId)}/events`);
      emitSuccess('topics events', response);
      return { handled: true };
    }
    if (subcommand === 'result') {
      const jobId = requirePosition(positionals, 2, 'topic job ID');
      const response = await request(config, 'GET', `/topic-jobs/${encodeURIComponent(jobId)}/result`);
      emitSuccess('topics result', response);
      return { handled: true };
    }
    if (subcommand === 'wait') {
      const jobId = requirePosition(positionals, 2, 'topic job ID');
      const result = await waitForTopic(config, jobId);
      await emitTopicWaitResult(result);
      return { handled: true };
    }
  }

  if (command === 'monitors') {
    if (subcommand === 'list') {
      const response = await request(config, 'GET', '/keyword-monitors');
      emitSuccess('monitors list', response);
      return { handled: true };
    }
    if (subcommand === 'create') {
      const keyword = requirePosition(positionals, 2, 'keyword');
      const platform = option('platform');
      if (!platform) throw new CliError('invalid_arguments', 'monitors create requires --platform.');
      const response = await request(config, 'POST', '/keyword-monitors', {
        body: { keyword, platform },
      });
      emitSuccess('monitors create', response);
      return { handled: true };
    }
    if (subcommand === 'get') {
      const monitorId = requirePosition(positionals, 2, 'monitor ID');
      const response = await request(config, 'GET', `/keyword-monitors/${encodeURIComponent(monitorId)}`);
      emitSuccess('monitors get', response);
      return { handled: true };
    }
    if (subcommand === 'results') {
      const monitorId = requirePosition(positionals, 2, 'monitor ID');
      const response = await request(config, 'GET', `/keyword-monitors/${encodeURIComponent(monitorId)}/results`);
      emitSuccess('monitors results', response);
      return { handled: true };
    }
    if (subcommand === 'run') {
      const monitorId = requirePosition(positionals, 2, 'monitor ID');
      requireConfirmation(5, 'Keyword monitor run');
      const response = await request(config, 'POST', `/keyword-monitors/${encodeURIComponent(monitorId)}/runs`, {
        body: {},
        timeoutMs: option('timeout-ms') || 180_000,
      });
      emitSuccess('monitors run', response);
      return { handled: true };
    }
    if (subcommand === 'delete') {
      const monitorId = requirePosition(positionals, 2, 'monitor ID');
      requireMutationConfirmation('Keyword monitor deletion');
      const response = await request(config, 'DELETE', `/keyword-monitors/${encodeURIComponent(monitorId)}`);
      emitSuccess('monitors delete', response);
      return { handled: true };
    }
  }

  if (command === 'images') {
    if (subcommand === 'models') {
      const response = await request(config, 'GET', '/images/models');
      emitSuccess('images models', response);
      return { handled: true };
    }
    if (subcommand === 'create') {
      requireConfirmation(4, 'Image generation');
      const body = (await readJsonInput()) || {
        prompt: option('prompt'),
        size: option('size') || '1:1',
        model: option('model') || undefined,
        style: option('style') || undefined,
        purpose: option('purpose') || undefined,
      };
      if (!body?.prompt) throw new CliError('invalid_arguments', 'images create requires --prompt or --data.');
      const response = await request(config, 'POST', '/images/jobs', { body });
      emitSuccess('images create', response);
      return { handled: true };
    }
    if (subcommand === 'get') {
      const jobId = requirePosition(positionals, 2, 'image job ID');
      const response = await request(config, 'GET', `/images/jobs/${encodeURIComponent(jobId)}`);
      emitSuccess('images get', response);
      return { handled: true };
    }
    if (subcommand === 'download') {
      const jobId = requirePosition(positionals, 2, 'image job ID');
      const output = option('output');
      if (!output) throw new CliError('invalid_arguments', 'images download requires --output.');
      const download = await downloadImage(config, jobId, output);
      process.stdout.write(`${JSON.stringify({ ok: true, command: 'images download', data: download }, null, 2)}\n`);
      return { handled: true };
    }
    if (subcommand === 'wait') {
      const jobId = requirePosition(positionals, 2, 'image job ID');
      const result = await waitForImage(config, jobId);
      process.stdout.write(`${JSON.stringify({ ok: true, command: 'images wait', data: result }, null, 2)}\n`);
      return { handled: true };
    }
  }

  if (command === 'visual-notes') {
    if (subcommand === 'list') {
      const query = [];
      const queryText = String(firstOption('query', '')).trim();
      if (queryText) query.push(`q=${queryText}`);
      if (option('category')) query.push(`category=${option('category')}`);
      if (option('scene')) query.push(`scene=${option('scene')}`);
      if (option('page')) query.push(`page=${option('page')}`);
      if (option('page-size')) query.push(`pageSize=${option('page-size')}`);
      if (option('sort')) query.push(`sort=${option('sort')}`);
      const response = await request(config, 'GET', '/visual-note/skills', { query });
      emitSuccess('visual-notes list', response);
      return { handled: true };
    }
    if (subcommand === 'recommend') {
      const query = String(firstOption('query', '')).trim();
      if (!query) throw new CliError('invalid_arguments', 'visual-notes recommend requires --query.');
      const response = await request(config, 'GET', '/visual-note/skills/recommendations', {
        query: [`q=${query}`, `limit=${option('limit') || 5}`],
      });
      emitSuccess('visual-notes recommend', response);
      return { handled: true };
    }
    if (subcommand === 'get') {
      const skillId = requirePosition(positionals, 2, 'visual-note Skill ID');
      const response = await request(config, 'GET', `/visual-note/skills/${encodeURIComponent(skillId)}`);
      emitSuccess('visual-notes get', response);
      return { handled: true };
    }
    if (subcommand === 'create') {
      requireCreditAction(
        'Visual-note generation',
        'runs on your Luka workspace and consumes credits according to the assistant run and generated images.',
      );
      const data = await readJsonInput();
      const skillId = option('skill-id') || option('skillName') || null;
      const prompt = option('prompt');
      const body = data || {
        mode: skillId ? 'selected' : 'auto',
        skillId,
        prompt,
        pageCount: option('page-count') ? Number(option('page-count')) : undefined,
        platform: option('platform') || undefined,
        imageModel: option('image-model') || undefined,
        imageAspectRatio: option('image-aspect-ratio') || undefined,
        clientRequestID: option('client-request-id') || undefined,
      };
      if (!body?.prompt) throw new CliError('invalid_arguments', 'visual-notes create requires --prompt or --data.');
      const response = await request(config, 'POST', '/visual-note/jobs', {
        body,
        headers: option('client-request-id') ? { 'Idempotency-Key': option('client-request-id') } : {},
      });
      emitSuccess('visual-notes create', response);
      return { handled: true };
    }
    if (subcommand === 'wait') {
      const jobId = requirePosition(positionals, 2, 'visual-note job ID');
      const job = await waitForVisualNote(config, jobId);
      const download = option('output-dir')
        ? await downloadVisualNote(config, job, option('output-dir'))
        : null;
      await emitVisualNoteJob('visual-notes wait', job, download ? { download } : {});
      return { handled: true };
    }
    if (subcommand === 'download') {
      const jobId = requirePosition(positionals, 2, 'visual-note job ID');
      const outputDir = option('output-dir');
      if (!outputDir) throw new CliError('invalid_arguments', 'visual-notes download requires --output-dir.');
      const response = await request(config, 'GET', `/visual-note/jobs/${encodeURIComponent(jobId)}`);
      const job = visualNoteJobFromResponse(response);
      if (job.status !== 'succeeded') {
        throw new CliError('visual_note_not_ready', `Visual-note job is ${job.status}.`, job);
      }
      const download = await downloadVisualNote(config, job, outputDir);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        command: 'visual-notes download',
        data: download,
      }, null, 2)}\n`);
      return { handled: true };
    }
  }

  throw new CliError(
    'unknown_command',
    `Unknown command: ${positionals.join(' ')}. Run "node scripts/luka-api.mjs --help".`,
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  globalThis.__lukaPositionals = parsed.positionals;
  globalThis.__lukaOptions = parsed.options;

  if (parsed.options.help || parsed.positionals.length === 0 || parsed.positionals[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const config = readConfig();
  const result = await dispatch(config);
  if (result?.help) process.stdout.write(HELP);
}

main().catch((error) => {
  const payload = error instanceof CliError
    ? { ok: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
    : { ok: false, error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error) } };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
