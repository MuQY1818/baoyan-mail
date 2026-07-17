import { useState } from "react";
import type React from "react";
import { Copy, Database, ExternalLink } from "lucide-react";
import { API_URL, LLMS_TXT_URL } from "../constants";

export function ApiHint(): React.ReactElement {
  const [copied, setCopied] = useState(false);

  function copyApiUrl(): void {
    void navigator.clipboard?.writeText(API_URL).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  return (
    <section className="api-hint" aria-label="面向 LLM 与 Agent 的数据接口">
      <div className="api-hint-body">
        <span className="api-hint-badge"><Database aria-hidden="true" size={14} /> Agent API</span>
        <div className="api-hint-text">
          <strong>结构化数据接口</strong>
          <p>
            本站全部 DDL 提供机器可读的 JSON，已开启跨域访问，可直接抓取，无需解析页面。
            接口说明见 <a href={LLMS_TXT_URL} rel="noreferrer" target="_blank">/llms.txt</a>。
          </p>
        </div>
      </div>
      <div className="api-hint-actions">
        <code className="api-hint-url">{API_URL}</code>
        <button className="api-hint-copy" onClick={copyApiUrl} type="button">
          <Copy aria-hidden="true" size={15} />
          {copied ? "已复制" : "复制接口地址"}
        </button>
        <a className="api-hint-open" href={API_URL} rel="noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" size={15} />
          打开 JSON
        </a>
      </div>
    </section>
  );
}
