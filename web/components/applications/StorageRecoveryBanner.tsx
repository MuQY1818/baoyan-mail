import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import type React from "react";
import type { ApplicationStorageIssue } from "../../types";

export function StorageRecoveryBanner({
  issue,
  onReset
}: {
  issue: ApplicationStorageIssue;
  onReset: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  function copyRawData(): void {
    void navigator.clipboard?.writeText(issue.rawValue).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  return (
    <section className="storage-recovery" role="alert">
      <div>
        <strong>本地申请数据暂时无法读取</strong>
        <p>{issue.message}。原始内容仍保留在浏览器中，请先备份，再决定是否重置。</p>
      </div>
      <div className="storage-recovery-actions">
        <button className="secondary-action" onClick={copyRawData} type="button">
          <Copy aria-hidden="true" size={16} />
          {copied ? "已复制" : "复制原始数据"}
        </button>
        <button
          className="danger-action"
          onClick={() => {
            if (window.confirm("重置后将清空当前浏览器中的异常申请数据，是否继续？")) {
              onReset();
            }
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" size={16} />
          重置本地数据
        </button>
      </div>
    </section>
  );
}
