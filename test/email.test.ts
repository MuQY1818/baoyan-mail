import { describe, expect, it } from "vitest";
import {
  buildAliyunSingleSendMailParams,
  percentEncode,
  signAliyunRpcParams
} from "../src/email";
import type { Env } from "../src/types";

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
