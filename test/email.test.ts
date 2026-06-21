import { describe, expect, it } from "vitest";
import {
  buildAliyunSingleSendMailParams,
  percentEncode,
  renderDailyDeadlineDigestEmail,
  renderNewDeadlineNotificationEmail,
  signAliyunRpcParams
} from "../src/email";
import type {
  DeadlineReminderWithItem,
  Env,
  NewDeadlineNotificationWithItem
} from "../src/types";

describe("aliyun direct mail", () => {
  it("builds SingleSendMail params", () => {
    const params = buildAliyunSingleSendMailParams(
      {
        MAIL_PROVIDER: "aliyun",
        ALIYUN_ACCESS_KEY_ID: "test-key-id",
        ALIYUN_ACCESS_KEY_SECRET: "test-key-secret",
        ALIYUN_DM_ACCOUNT_NAME: "notify@example.com",
        SENDER_NAME: "保研通知"
      } as Env,
      {
        toAddress: "student@example.com",
        subject: "确认订阅保研通知",
        htmlBody: "<p>确认订阅</p>"
      },
      {
        SignatureNonce: "nonce-for-test",
        Timestamp: "2026-05-11T00:00:00Z"
      }
    );

    expect(params).toMatchObject({
      Action: "SingleSendMail",
      Version: "2015-11-23",
      AccountName: "notify@example.com",
      ToAddress: "student@example.com",
      Subject: "确认订阅保研通知",
      HtmlBody: "<p>确认订阅</p>",
      AddressType: "0",
      ReplyToAddress: "false",
      FromAlias: "保研通知"
    });
  });

  it("percent-encodes RPC params with Aliyun rules", () => {
    expect(percentEncode("a b+c*~!()'")).toBe("a%20b%2Bc%2A~%21%28%29%27");
  });

  it("generates stable HMAC-SHA1 signatures", async () => {
    const signature = await signAliyunRpcParams(
      "POST",
      {
        AccessKeyId: "test-key-id",
        Action: "SingleSendMail",
        Format: "JSON",
        SignatureMethod: "HMAC-SHA1",
        SignatureNonce: "nonce-for-test",
        SignatureVersion: "1.0",
        Timestamp: "2026-05-11T00:00:00Z",
        Version: "2015-11-23"
      },
      "test-key-secret"
    );

    expect(signature).toBe("YVCycQ0WO1qOlYrxNw8t/k/cfmo=");
  });
});

describe("daily deadline digest email", () => {
  it("renders daily digest summary and links", () => {
    const reminder: DeadlineReminderWithItem = {
      id: 1,
      item_key: "item-key",
      deadline_at: "2026-06-09T16:00:00.000Z",
      reminder_window_days: 3,
      payload: "",
      created_at: "2026-06-07T01:00:00.000Z",
      sent_at: null,
      item: {
        key: "item-key",
        contentHash: "content-hash",
        sourceGroup: "camp2026",
        name: "南京大学",
        institute: "计算机学院",
        description: "夏令营通知",
        deadline: "2026-06-10T00:00:00+08:00",
        website: "https://example.com/notice",
        tags: ["C9"]
      }
    };

    const html = renderDailyDeadlineDigestEmail(
      [reminder],
      "https://example.com/api/unsubscribe?token=token",
      new Date("2026-06-07T01:00:00.000Z")
    );

    expect(html).toContain("保研通知未来 15 天 DDL 汇总");
    expect(html).toContain("未来 15 天内共有 1 条保研通知即将截止");
    expect(html).toContain("3 天内截止");
    expect(html).toContain("学校层次");
    expect(html).toContain("华五");
    expect(html).toContain("https://example.com/notice");
    expect(html).toContain("https://example.com/api/unsubscribe?token=token");
  });
});

describe("new deadline notification email", () => {
  it("renders new deadline summary and links", () => {
    const notification: NewDeadlineNotificationWithItem = {
      id: 1,
      item_key: "item-key",
      deadline_at: "2026-06-09T16:00:00.000Z",
      payload: "",
      created_at: "2026-06-07T01:00:00.000Z",
      sent_at: null,
      item: {
        key: "item-key",
        contentHash: "content-hash",
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "北京大学",
        institute: "计算机学院",
        description: "夏令营通知",
        deadline: "2026-06-10T00:00:00+08:00",
        website: "https://example.com/notice",
        tags: ["保研信息平台", "计算机大类"]
      }
    };

    const html = renderNewDeadlineNotificationEmail(
      [notification],
      "https://example.com/api/unsubscribe?token=token",
      new Date("2026-06-07T01:00:00.000Z")
    );

    expect(html).toContain("保研通知新增 DDL");
    expect(html).toContain("本次发现 1 条新增 DDL");
    expect(html).toContain("Top2");
    expect(html).not.toContain("计算机大类");
    expect(html).toContain("https://example.com/notice");
  });
});
