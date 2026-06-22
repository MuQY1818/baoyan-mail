import {
  approveReviewCandidate,
  confirmSubscriberByToken,
  findSubscriberByEmail,
  getAppState,
  getPendingReviewCandidates,
  getReviewCandidateById,
  getSnapshotRows,
  insertReviewRule,
  rejectReviewCandidate,
  unsubscribeByToken,
  upsertManualItem,
  upsertPendingSubscriber
} from "./db";
import { buildDdlResponse } from "./ddl";
import { sendConfirmationEmail } from "./email";
import { runCheck } from "./checker";
import { createToken, sha256Hex, tokenHash } from "./crypto";
import {
  canonicalizeNotificationUrl,
  createManualItemFromReviewPayload,
  normalizeBaoyanXinxiDeadline
} from "./source";
import { upsertReviewCandidates, upsertSnapshots } from "./db";
import type { Env, ReviewCandidatePayload } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REVIEW_COOKIE_NAME = "baoyan_review_auth";
const REVIEW_SESSION_MAX_AGE_SECONDS = 6 * 60 * 60;

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      return htmlResponse(renderSubscribePage());
    }
    if (request.method === "POST" && url.pathname === "/api/subscribe") {
      return await handleSubscribe(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/confirm") {
      return await handleConfirm(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/unsubscribe") {
      return await handleUnsubscribe(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ ok: true, time: new Date().toISOString() });
    }
    if (request.method === "GET" && url.pathname === "/api/ddl") {
      return await handleDdl(env);
    }
    if (
      request.method === "OPTIONS" &&
      (url.pathname === "/api/ddl" || url.pathname === "/api/missing-link")
    ) {
      return handleDdlPreflight();
    }
    if (request.method === "POST" && url.pathname === "/api/missing-link") {
      return await handleMissingLink(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/run-check") {
      return await handleManualRun(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/sync-sources") {
      return await handleSyncSources(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/review") {
      return await handleReviewPage(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/review/candidates") {
      return await handleReviewCandidatesJson(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/review/login") {
      return await handleReviewLogin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/review/approve") {
      return await handleReviewApprove(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/review/reject") {
      return await handleReviewReject(request, env);
    }
    return htmlResponse(renderMessagePage("页面不存在", "请检查访问地址。"), 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return htmlResponse(renderMessagePage("服务暂时不可用", message), 500);
  }
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email) && email.length <= 254;
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const email = await readEmailFromRequest(request);
  if (!isValidEmail(email)) {
    return htmlResponse(renderMessagePage("邮箱格式不正确", "请返回后填写有效邮箱地址。"), 400);
  }

  const existing = await findSubscriberByEmail(env, email);
  if (existing?.status === "active") {
    return htmlResponse(
      renderMessagePage("订阅请求已收到", "如果该邮箱已经订阅，将继续收到后续 DDL 邮件。")
    );
  }

  const confirmToken = createToken();
  const unsubscribeToken = createToken();
  const confirmTokenHash = await tokenHash(confirmToken);
  const now = new Date().toISOString();
  await upsertPendingSubscriber(env, email, confirmTokenHash, unsubscribeToken, now);

  const baseUrl = getPublicBaseUrl(env, request);
  const confirmUrl = `${baseUrl}/api/confirm?token=${encodeURIComponent(confirmToken)}`;
  await sendConfirmationEmail(env, email, confirmUrl);

  return htmlResponse(
    renderMessagePage("确认邮件已发送", "请查看邮箱并点击确认链接，确认后才会收到 DDL 邮件。")
  );
}

async function handleConfirm(url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("token");
  if (token === null || token.trim() === "") {
    return htmlResponse(renderMessagePage("确认链接无效", "链接缺少确认参数。"), 400);
  }

  const subscriber = await confirmSubscriberByToken(
    env,
    await tokenHash(token),
    new Date().toISOString()
  );
  if (subscriber === null) {
    return htmlResponse(renderMessagePage("确认链接无效", "链接可能已经使用或已经过期。"), 400);
  }

  return htmlResponse(
    renderMessagePage("订阅成功", "之后会收到每日 DDL 汇总和新增 DDL 提醒。")
  );
}

async function handleUnsubscribe(url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("token");
  if (token === null || token.trim() === "") {
    return htmlResponse(renderMessagePage("退订链接无效", "链接缺少退订参数。"), 400);
  }

  const subscriber = await unsubscribeByToken(env, token, new Date().toISOString());
  if (subscriber === null) {
    return htmlResponse(renderMessagePage("退订链接无效", "链接可能已经失效。"), 400);
  }

  return htmlResponse(renderMessagePage("退订成功", "该邮箱之后不会再收到保研通知邮件。"));
}

async function handleManualRun(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const resultPromise = runCheck(env, getPublicBaseUrl(env, request));
  ctx.waitUntil(resultPromise);
  const result = await resultPromise;
  return jsonResponse({ ok: true, result });
}

async function handleSyncSources(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const resultPromise = runCheck(env, getPublicBaseUrl(env, request), { sendEmails: false });
  ctx.waitUntil(resultPromise);
  const result = await resultPromise;
  return jsonResponse({ ok: true, result });
}

async function handleDdl(env: Env): Promise<Response> {
  const response = buildDdlResponse(
    await getSnapshotRows(env),
    new Date(),
    await getAppState(env, "last_synced_at")
  );
  return jsonResponse(response, 200, {
    "cache-control": "public, max-age=300, s-maxage=900",
    // 允许 LLM / Agent 在浏览器端跨域抓取结构化数据
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS"
  });
}

async function handleMissingLink(request: Request, env: Env): Promise<Response> {
  const body = await readReviewPayloadFromRequest(request);
  const website = body.website.trim();
  const normalizedUrl = canonicalizeNotificationUrl(website);
  if (normalizedUrl === "") {
    return jsonResponse({ ok: false, error: "invalid_url" }, 400, corsHeaders());
  }

  const now = new Date().toISOString();
  await upsertReviewCandidates(
    env,
    [
      {
        normalizedUrl,
        sourceGroup: "user-submission",
        reason: "user-submitted",
        payload: {
          sourceGroup: "user-submission",
          name: body.name.trim(),
          institute: body.institute.trim(),
          description: body.description.trim() || "用户提交缺漏链接",
          deadline: normalizeBaoyanXinxiDeadline(body.deadline.trim()),
          website,
          submittedBy: (body.submittedBy ?? "").trim(),
          note: (body.note ?? "").trim()
        }
      }
    ],
    now
  );
  return jsonResponse({ ok: true }, 200, corsHeaders());
}

async function handleReviewPage(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return htmlResponse(renderReviewLoginPage());
  }

  return htmlResponse(renderReviewPage(await getPendingReviewCandidates(env)));
}

async function handleReviewCandidatesJson(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return jsonResponse({ ok: true, candidates: await getPendingReviewCandidates(env) });
}

async function handleReviewLogin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!(await isValidReviewPassword(env, password))) {
    return htmlResponse(renderMessagePage("无法进入审核页", "管理员密码不正确。"), 401);
  }

  return redirectResponse("/api/admin/review", {
    "set-cookie": buildReviewSessionCookie(request, await getReviewSessionValue(env))
  });
}

async function handleReviewApprove(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const form = await request.formData();
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const candidate = Number.isFinite(id) ? await getReviewCandidateById(env, id) : null;
  if (candidate === null) {
    return htmlResponse(renderMessagePage("候选不存在", "请返回审核页刷新后再试。"), 404);
  }

  const payload = mergeCandidatePayload(candidate.candidate, {
    sourceGroup: candidate.candidate.sourceGroup,
    name: String(form.get("name") ?? ""),
    institute: String(form.get("institute") ?? ""),
    description: String(form.get("description") ?? ""),
    deadline: String(form.get("deadline") ?? ""),
    website: String(form.get("website") ?? "")
  });
  if (payload.name === "" || payload.website === "") {
    return htmlResponse(renderMessagePage("字段不完整", "学校和原始链接不能为空。"), 400);
  }

  const now = new Date().toISOString();
  const item = await createManualItemFromReviewPayload(payload);
  await upsertManualItem(env, item, now);
  await upsertSnapshots(env, [item], now);
  await approveReviewCandidate(env, candidate.id, toNullableString(form.get("note")), now);
  await insertReviewRule(env, "allow", candidate.normalized_url, toNullableString(form.get("note")), now);
  return redirectResponse("/api/admin/review");
}

async function handleReviewReject(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const form = await request.formData();
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const candidate = Number.isFinite(id) ? await getReviewCandidateById(env, id) : null;
  if (candidate === null) {
    return htmlResponse(renderMessagePage("候选不存在", "请返回审核页刷新后再试。"), 404);
  }

  const now = new Date().toISOString();
  const note = toNullableString(form.get("note"));
  await rejectReviewCandidate(env, candidate.id, note, now);
  await insertReviewRule(env, "reject", candidate.normalized_url, note, now);
  return redirectResponse("/api/admin/review");
}

function handleDdlPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400"
    }
  });
}

async function readReviewPayloadFromRequest(request: Request): Promise<ReviewCandidatePayload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return {
      sourceGroup: "user-submission",
      name: readString(body.name),
      institute: readString(body.institute),
      description: readString(body.description),
      deadline: readString(body.deadline),
      website: readString(body.website),
      submittedBy: readString(body.submittedBy),
      note: readString(body.note)
    };
  }

  const form = await request.formData();
  return {
    sourceGroup: "user-submission",
    name: String(form.get("name") ?? ""),
    institute: String(form.get("institute") ?? ""),
    description: String(form.get("description") ?? ""),
    deadline: String(form.get("deadline") ?? ""),
    website: String(form.get("website") ?? ""),
    submittedBy: String(form.get("submittedBy") ?? ""),
    note: String(form.get("note") ?? "")
  };
}

async function readEmailFromRequest(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  }

  const form = await request.formData();
  const email = form.get("email");
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  if (env.ADMIN_TOKEN === undefined || env.ADMIN_TOKEN.trim() === "") {
    return false;
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return queryToken === env.ADMIN_TOKEN || bearerToken === env.ADMIN_TOKEN;
}

async function isAuthorizedReviewAdmin(request: Request, env: Env): Promise<boolean> {
  const cookie = getCookie(request, REVIEW_COOKIE_NAME);
  if (cookie === null) {
    return false;
  }
  return cookie === (await getReviewSessionValue(env));
}

async function isValidReviewPassword(env: Env, password: string): Promise<boolean> {
  const configured = env.ADMIN_REVIEW_PASSWORD?.trim();
  if (configured === undefined || configured === "") {
    return false;
  }
  return (await sha256Hex(`review-password:${password}`)) ===
    (await sha256Hex(`review-password:${configured}`));
}

async function getReviewSessionValue(env: Env): Promise<string> {
  const configured = env.ADMIN_REVIEW_PASSWORD?.trim() ?? "";
  const salt = env.ADMIN_TOKEN?.trim() ?? "review";
  return sha256Hex(`review-session:${configured}:${salt}`);
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) {
    return null;
  }
  for (const entry of cookieHeader.split(";")) {
    const [key, ...valueParts] = entry.trim().split("=");
    if (key === name) {
      return valueParts.join("=");
    }
  }
  return null;
}

function buildReviewSessionCookie(request: Request, value: string): string {
  const isHttps = new URL(request.url).protocol === "https:";
  return [
    `${REVIEW_COOKIE_NAME}=${value}`,
    "Path=/api/admin/review",
    `Max-Age=${REVIEW_SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    isHttps ? "Secure" : "",
    "SameSite=Lax"
  ]
    .filter((part) => part !== "")
    .join("; ");
}

function getRequestBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function getPublicBaseUrl(env: Env, request: Request): string {
  const baseUrl = env.APP_BASE_URL?.trim();
  if (baseUrl !== undefined && baseUrl !== "") {
    return baseUrl.replace(/\/+$/, "");
  }
  return getRequestBaseUrl(request);
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function redirectResponse(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      ...headers
    }
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*"
  };
}

function renderSubscribePage(): string {
  return renderPage(
    "保研通知订阅",
    `
      <p class="lead">订阅后，系统会发送未来 15 天 DDL 汇总和新增 DDL 提醒。</p>
      <form action="/api/subscribe" method="post">
        <label for="email">邮箱地址</label>
        <div class="field">
          <input id="email" name="email" type="email" autocomplete="email" required placeholder="name@example.com">
          <button type="submit">订阅</button>
        </div>
      </form>
      <p class="note">提交后需要点击确认邮件中的链接。每封通知邮件都带退订链接。</p>
    `
  );
}

function renderMessagePage(title: string, message: string): string {
  return renderPage(
    title,
    `
      <p class="lead">${escapeHtml(message)}</p>
      <p><a href="/">返回订阅页</a></p>
    `
  );
}

function renderReviewLoginPage(): string {
  return renderPage(
    "候选审核登录",
    `
      <p class="lead">请输入管理员密码进入候选审核页面。</p>
      <form action="/api/admin/review/login" method="post">
        <label for="password">管理员密码</label>
        <div class="field">
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">进入审核</button>
        </div>
      </form>
    `
  );
}

function renderReviewPage(
  candidates: Array<{
    id: number;
    reason: string;
    updated_at: string;
    candidate: ReviewCandidatePayload;
  }>
): string {
  const body =
    candidates.length === 0
      ? '<p class="lead">当前没有待审核候选。</p>'
      : candidates.map(renderReviewCandidate).join("");
  return renderPage(
    "候选条目审核",
    `
      <p class="lead">审核通过后会进入公开 DDL 数据；拒绝后不会重复进入候选池。</p>
      <div class="review-list">${body}</div>
    `
  );
}

function renderReviewCandidate(candidate: {
  id: number;
  reason: string;
  updated_at: string;
  candidate: ReviewCandidatePayload;
}): string {
  const payload = candidate.candidate;
  return `
    <section class="review-card">
      <div class="review-meta">
        <strong>#${candidate.id}</strong>
        <span>${escapeHtml(candidate.reason)}</span>
        <span>${escapeHtml(formatReviewTime(candidate.updated_at))}</span>
      </div>
      <form action="/api/admin/review/approve" method="post">
        <input type="hidden" name="id" value="${candidate.id}">
        <label>学校
          <input name="name" value="${escapeHtml(payload.name)}" required>
        </label>
        <label>院系
          <input name="institute" value="${escapeHtml(payload.institute)}">
        </label>
        <label>截止时间
          <input name="deadline" value="${escapeHtml(payload.deadline)}">
        </label>
        <label>原始链接
          <input name="website" value="${escapeHtml(payload.website)}" required>
        </label>
        <label>简介
          <textarea name="description" rows="2">${escapeHtml(payload.description)}</textarea>
        </label>
        <label>备注
          <input name="note" value="">
        </label>
        <div class="review-actions">
          <button type="submit">批准公开</button>
        </div>
      </form>
      <form action="/api/admin/review/reject" method="post">
        <input type="hidden" name="id" value="${candidate.id}">
        <div class="review-actions">
          <input name="note" placeholder="拒绝备注，可选">
          <button class="secondary" type="submit">拒绝</button>
        </div>
      </form>
    </section>
  `;
}

function renderPage(title: string, body: string): string {
  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #eef2f6;
            --panel: #ffffff;
            --text: #1f2937;
            --muted: #596579;
            --border: #d7dde8;
            --accent: #0f766e;
            --accent-dark: #115e59;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.6;
          }
          main {
            width: min(720px, calc(100% - 32px));
            margin: 0 auto;
            padding: 64px 0;
          }
          .panel {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 28px;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
            line-height: 1.25;
          }
          .lead {
            color: var(--muted);
            margin: 0 0 24px;
          }
          label {
            display: block;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .field {
            display: flex;
            gap: 10px;
          }
          input {
            flex: 1 1 auto;
            min-width: 0;
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text);
            font: inherit;
            padding: 11px 12px;
          }
          textarea {
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text);
            font: inherit;
            min-height: 72px;
            padding: 10px 12px;
            resize: vertical;
            width: 100%;
          }
          button {
            flex: 0 0 auto;
            border: 0;
            border-radius: 6px;
            background: var(--accent);
            color: #ffffff;
            cursor: pointer;
            font: inherit;
            font-weight: 700;
            padding: 11px 18px;
          }
          button:hover {
            background: var(--accent-dark);
          }
          button.secondary {
            background: #475569;
          }
          button.secondary:hover {
            background: #334155;
          }
          a {
            color: var(--accent);
          }
          .note {
            color: var(--muted);
            font-size: 14px;
            margin: 16px 0 0;
          }
          .review-list {
            display: grid;
            gap: 16px;
          }
          .review-card {
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px;
          }
          .review-card form {
            display: grid;
            gap: 12px;
            margin-top: 12px;
          }
          .review-card label {
            display: grid;
            gap: 6px;
          }
          .review-meta {
            align-items: center;
            color: var(--muted);
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            font-size: 13px;
          }
          .review-actions {
            align-items: center;
            display: flex;
            gap: 10px;
          }
          .review-actions input {
            flex: 1 1 auto;
          }
          @media (max-width: 560px) {
            main {
              padding: 32px 0;
            }
            .panel {
              padding: 22px;
            }
            .field {
              flex-direction: column;
            }
            button {
              width: 100%;
            }
            .review-actions {
              align-items: stretch;
              flex-direction: column;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <section class="panel">
            <h1>${escapeHtml(title)}</h1>
            ${body}
          </section>
        </main>
      </body>
    </html>
  `;
}

function mergeCandidatePayload(
  original: ReviewCandidatePayload,
  updates: ReviewCandidatePayload
): ReviewCandidatePayload {
  return {
    ...original,
    name: updates.name.trim(),
    institute: updates.institute.trim(),
    description: updates.description.trim() || original.description,
    deadline: normalizeBaoyanXinxiDeadline(updates.deadline.trim()),
    website: updates.website.trim()
  };
}

function toNullableString(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatReviewTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
