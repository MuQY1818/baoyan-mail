import type { Env, NotificationWithItem, SubscriberRow } from "./types";

const ALIYUN_DM_ENDPOINT = "https://dm.aliyuncs.com/";
const ALIYUN_DM_VERSION = "2015-11-23";
const DEFAULT_REGION_ID = "cn-hangzhou";

export interface SendEmailResult {
  messageId: string | null;
}

export interface DirectMailMessage {
  toAddress: string;
  subject: string;
  htmlBody: string;
}

export async function sendConfirmationEmail(
  env: Env,
  email: string,
  confirmUrl: string
): Promise<SendEmailResult> {
  const htmlContent = renderLayout(
    "确认订阅保研通知",
    `
      <p>请点击下面的链接确认订阅。</p>
      <p><a href="${escapeAttribute(confirmUrl)}">确认订阅</a></p>
      <p>如果不是你本人操作，可以忽略这封邮件。</p>
    `
  );
  return sendAliyunDirectMail(env, {
    toAddress: email,
    subject: "确认订阅保研通知",
    htmlBody: htmlContent
  });
}

export async function sendSummaryEmails(
  env: Env,
  subscribers: SubscriberRow[],
  notifications: NotificationWithItem[],
  baseUrl: string,
  chunkIndex: number
): Promise<SendEmailResult> {
  const subject = `保研通知更新摘要：${notifications.length} 条`;
  const messageIds: string[] = [];

  for (const subscriber of subscribers) {
    const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(
      subscriber.unsubscribe_token
    )}`;
    const result = await sendAliyunDirectMail(env, {
      toAddress: subscriber.email,
      subject,
      htmlBody: renderSummaryEmail(notifications, unsubscribeUrl)
    });
    if (result.messageId !== null) {
      messageIds.push(result.messageId);
    }
  }

  return { messageId: messageIds.length > 0 ? messageIds.join(",") : `batch-${chunkIndex}` };
}

export function renderSummaryEmail(
  notifications: NotificationWithItem[],
  unsubscribeUrl: string
): string {
  const addedCount = notifications.filter((notification) => notification.kind === "added").length;
  const changedCount = notifications.length - addedCount;
  const entries = notifications
    .map((notification) => {
      const item = notification.item;
      const kindText = notification.kind === "added" ? "新增" : "变更";
      const tags = item.tags.length > 0 ? item.tags.join(" / ") : "未标注";
      const description =
        item.description === "" || item.description === "_No response_"
          ? "暂无补充说明"
          : item.description;
      const deadlineText = formatDeadline(item.deadline);
      return `
        <section class="notice">
          <div class="notice-head">
            <span class="badge">${escapeHtml(kindText)}</span>
            <span class="source">${escapeHtml(formatSourceGroup(item.sourceGroup))}</span>
          </div>
          <h2>${escapeHtml(item.name)}</h2>
          <p class="institute">${escapeHtml(item.institute || "未提供院系")}</p>
          <dl class="meta">
            <div>
              <dt>截止时间</dt>
              <dd>${escapeHtml(deadlineText)}</dd>
            </div>
            <div>
              <dt>标签</dt>
              <dd>${escapeHtml(tags)}</dd>
            </div>
          </dl>
          <p class="description">${escapeHtml(truncateText(description, 220))}</p>
          ${
            item.website
              ? `<p class="actions"><a class="button" href="${escapeAttribute(item.website)}">查看原始通知</a></p>`
              : `<p class="missing-link">原始链接未提供</p>`
          }
        </section>
      `;
    })
    .join("");

  return renderLayout(
    `保研通知更新摘要`,
    `
      <section class="summary">
        <p class="eyebrow">CS-BAOYAN-DDL 更新</p>
        <p class="summary-title">本次发现 ${notifications.length} 条保研通知更新</p>
        <p class="summary-meta">新增 ${addedCount} 条，变更 ${changedCount} 条。请以学校官网原始通知为准。</p>
      </section>
      ${entries}
      <p class="footer">
        数据来源：CS-BAOYAN-DDL。你收到这封邮件是因为订阅了保研通知摘要。
        <br>
        不想继续接收邮件，可以点击 <a href="${escapeAttribute(unsubscribeUrl)}">退订链接</a>。
      </p>
    `
  );
}

function renderLayout(title: string, body: string): string {
  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            background: #eef2f6;
            color: #172033;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.65;
          }
          main {
            max-width: 720px;
            margin: 0 auto;
            padding: 32px 20px;
          }
          .panel {
            background: #ffffff;
            border: 1px solid #d7dde8;
            border-radius: 8px;
            padding: 28px;
          }
          h1 {
            margin: 0 0 18px;
            font-size: 22px;
            line-height: 1.3;
          }
          h2 {
            color: #111827;
            font-size: 20px;
            line-height: 1.35;
            margin: 12px 0 4px;
          }
          a {
            color: #0f766e;
          }
          .summary {
            background: #f0fdfa;
            border: 1px solid #99f6e4;
            border-radius: 8px;
            margin: 0 0 18px;
            padding: 18px;
          }
          .eyebrow {
            color: #0f766e;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0;
            margin: 0 0 6px;
          }
          .summary-title {
            color: #111827;
            font-size: 20px;
            font-weight: 800;
            line-height: 1.35;
            margin: 0;
          }
          .summary-meta {
            color: #4b5563;
            margin: 8px 0 0;
          }
          .notice {
            border: 1px solid #d7dde8;
            border-radius: 8px;
            margin-top: 16px;
            padding: 18px;
          }
          .notice-head {
            align-items: center;
            display: flex;
            justify-content: space-between;
            gap: 12px;
          }
          .badge {
            background: #0f766e;
            border-radius: 999px;
            color: #ffffff;
            display: inline-block;
            font-size: 12px;
            font-weight: 700;
            padding: 3px 10px;
          }
          .source {
            color: #667085;
            font-size: 13px;
          }
          .institute {
            color: #4b5563;
            margin: 0 0 14px;
          }
          .meta {
            background: #f8fafc;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            margin: 0;
            padding: 12px 14px;
          }
          .meta div {
            margin: 0 0 8px;
          }
          .meta div:last-child {
            margin-bottom: 0;
          }
          dt {
            color: #667085;
            font-size: 12px;
            font-weight: 700;
            margin: 0;
          }
          dd {
            color: #172033;
            font-weight: 700;
            margin: 2px 0 0;
          }
          .description {
            color: #344054;
            margin: 14px 0 0;
          }
          .actions {
            margin: 16px 0 0;
          }
          .button {
            background: #0f766e;
            border-radius: 6px;
            color: #ffffff;
            display: inline-block;
            font-weight: 700;
            padding: 9px 14px;
            text-decoration: none;
          }
          .missing-link {
            color: #667085;
            font-size: 14px;
            margin: 14px 0 0;
          }
          .footer {
            border-top: 1px solid #e5e7eb;
            color: #4b5563;
            font-size: 14px;
            margin-top: 24px;
            padding-top: 16px;
          }
        </style>
      </head>
      <body>
        <main>
          <div class="panel">
            <h1>${escapeHtml(title)}</h1>
            ${body}
          </div>
        </main>
      </body>
    </html>
  `;
}

function formatDeadline(deadline: string): string {
  if (deadline === "") {
    return "未提供";
  }
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) {
    return deadline;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatSourceGroup(sourceGroup: string): string {
  const match = /^(camp|yutuimian)(\d{4})$/.exec(sourceGroup);
  if (match === null) {
    return sourceGroup;
  }
  const type = match[1] === "camp" ? "夏令营" : "预推免";
  return `${match[2]} ${type}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

export async function sendAliyunDirectMail(
  env: Env,
  message: DirectMailMessage
): Promise<SendEmailResult> {
  const params = buildAliyunSingleSendMailParams(env, message);
  const signature = await signAliyunRpcParams(
    "POST",
    params,
    requireEnv(env.ALIYUN_ACCESS_KEY_SECRET, "ALIYUN_ACCESS_KEY_SECRET")
  );
  const body = toFormBody({
    Signature: signature,
    ...params
  });

  const response = await fetch(env.ALIYUN_DM_ENDPOINT ?? ALIYUN_DM_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();
  const data = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok || typeof data.Code === "string") {
    const code = typeof data.Code === "string" ? data.Code : String(response.status);
    const messageText = typeof data.Message === "string" ? data.Message : text;
    throw new Error(`阿里云邮件推送发信失败：${code} ${messageText}`);
  }

  const envId = typeof data.EnvId === "string" ? data.EnvId : null;
  const requestId = typeof data.RequestId === "string" ? data.RequestId : null;
  return { messageId: envId ?? requestId };
}

export function buildAliyunSingleSendMailParams(
  env: Env,
  message: DirectMailMessage,
  overrides: Partial<Record<string, string>> = {}
): Record<string, string> {
  assertAliyunProvider(env);
  return {
    AccessKeyId: requireEnv(env.ALIYUN_ACCESS_KEY_ID, "ALIYUN_ACCESS_KEY_ID"),
    AccountName: requireEnv(env.ALIYUN_DM_ACCOUNT_NAME, "ALIYUN_DM_ACCOUNT_NAME"),
    Action: "SingleSendMail",
    AddressType: "0",
    Format: "JSON",
    FromAlias: env.SENDER_NAME ?? "保研通知",
    HtmlBody: message.htmlBody,
    RegionId: env.ALIYUN_REGION_ID ?? DEFAULT_REGION_ID,
    ReplyToAddress: "false",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Subject: message.subject,
    Timestamp: formatAliyunTimestamp(new Date()),
    ToAddress: message.toAddress,
    UnSubscribeLinkType: "disabled",
    Version: ALIYUN_DM_VERSION,
    ...overrides
  };
}

export async function signAliyunRpcParams(
  method: "GET" | "POST",
  params: Record<string, string>,
  accessKeySecret: string
): Promise<string> {
  const canonicalizedQueryString = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key] ?? "")}`)
    .join("&");
  const stringToSign = [
    method,
    percentEncode("/"),
    percentEncode(canonicalizedQueryString)
  ].join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${accessKeySecret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  return base64Encode(new Uint8Array(signature));
}

export function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("+", "%20")
    .replaceAll("*", "%2A")
    .replaceAll("%7E", "~")
    .replaceAll("!", "%21")
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

function assertAliyunProvider(env: Env): void {
  const provider = env.MAIL_PROVIDER ?? "aliyun";
  if (provider !== "aliyun") {
    throw new Error(`不支持的邮件服务商：${provider}`);
  }
}

function formatAliyunTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function requireEnv(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`缺少环境变量：${name}`);
  }
  return value;
}

function toFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join("&");
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
