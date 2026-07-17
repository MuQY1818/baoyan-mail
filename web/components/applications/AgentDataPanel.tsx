import { Check, Copy, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import type React from "react";
import {
  APPLICATION_PATCH_SCHEMA,
  APPLICATION_TRACKER_SCHEMA,
  parseApplicationPatch,
  previewApplicationPatch,
  type ApplicationTrackerData,
  type PatchPreview
} from "../../applicationTracker";

export function AgentDataPanel({
  data,
  onReplaceData
}: {
  data: ApplicationTrackerData;
  onReplaceData: (data: ApplicationTrackerData) => void;
}): React.ReactElement {
  const exportJson = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const [patchText, setPatchText] = useState("");
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function copyExport(): void {
    void navigator.clipboard?.writeText(exportJson).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  function buildPreview(): void {
    try {
      const patch = parseApplicationPatch(JSON.parse(patchText)) ;
      const nextPreview = previewApplicationPatch(data, patch);
      setPreview(nextPreview);
      setError(null);
    } catch (previewError) {
      setPreview(null);
      setError(previewError instanceof Error ? previewError.message : "Patch 解析失败");
    }
  }

  function applyPreview(): void {
    if (preview === null || preview.errors.length > 0) {
      return;
    }
    onReplaceData(preview.nextData);
    setPatchText("");
    setPreview(null);
  }

  return (
    <section className="agent-panel" aria-label="Agent 数据接口">
      <div className="agent-copy">
        <span className="section-kicker">AGENT JSON</span>
        <h3>本地申请数据</h3>
        <p>
          导出给 Codex 分析，导入 `{APPLICATION_PATCH_SCHEMA}` patch 前会先预览差异。
          页面也暴露 `window.BaoyanAgent`，可在当前浏览器内调用本地 CRUD。
        </p>
      </div>
      <div className="agent-grid">
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>{APPLICATION_TRACKER_SCHEMA}</strong>
            <button className="icon-action" onClick={copyExport} type="button">
              <Copy aria-hidden="true" size={16} />
              {copied ? "已复制" : "复制 JSON"}
            </button>
          </div>
          <textarea readOnly rows={9} value={exportJson} />
        </div>
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>导入 Patch</strong>
            <button className="icon-action" onClick={buildPreview} type="button">
              <Eye aria-hidden="true" size={16} />
              预览
            </button>
          </div>
          <textarea
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              setPatchText(event.currentTarget.value);
              setPreview(null);
              setError(null);
            }}
            placeholder={`{\n  "schema": "${APPLICATION_PATCH_SCHEMA}",\n  "operations": []\n}`}
            rows={9}
            value={patchText}
          />
          {error !== null && <p className="agent-error">{error}</p>}
          {preview !== null && (
            <div className="patch-preview">
              <strong>{preview.appliedCount} 条可应用操作</strong>
              {preview.errors.length > 0 ? (
                <ul>{preview.errors.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              ) : (
                <>
                  <ul>{preview.summary.slice(0, 6).map((entry) => <li key={entry}>{entry}</li>)}</ul>
                  <button className="chip chip-active" onClick={applyPreview} type="button">
                    <Check aria-hidden="true" size={16} />
                    确认应用
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
