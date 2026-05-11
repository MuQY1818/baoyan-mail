import {
  confirmSubscriberByToken,
  findSubscriberByEmail,
  unsubscribeByToken,
  upsertPendingSubscriber
} from "./db";
import { sendConfirmationEmail } from "./email";
import { runCheck } from "./checker";
import { createToken, tokenHash } from "./crypto";
import type { Env } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (request.method === "GET" && url.pathname === "/api/admin/run-check") {
      return await handleManualRun(request, env, ctx);
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
      renderMessagePage("订阅请求已收到", "如果该邮箱已经订阅，将继续收到后续摘要。")
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
    renderMessagePage("确认邮件已发送", "请查看邮箱并点击确认链接，确认后才会收到更新摘要。")
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

  return htmlResponse(renderMessagePage("订阅成功", "之后有保研通知更新时，你会收到邮件摘要。"));
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

  return htmlResponse(renderMessagePage("退订成功", "该邮箱之后不会再收到保研通知摘要。"));
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function renderSubscribePage(): string {
  return renderPage(
    "保研通知订阅",
    `
      <p class="lead">订阅后，系统会在发现 CS-BAOYAN-DDL 数据更新时发送每日邮件摘要。</p>
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
          a {
            color: var(--accent);
          }
          .note {
            color: var(--muted);
            font-size: 14px;
            margin: 16px 0 0;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
