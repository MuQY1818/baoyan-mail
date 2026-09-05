import { Check, Copy, Download, Eye, Upload } from "lucide-react";
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
import { validateApplicationData } from "../../utils/applicationStorage";

export function AgentDataPanel({
  data,
  onReplaceData
}: {
  data: ApplicationTrackerData;
  onReplaceData: (data: ApplicationTrackerData) => boolean;
}): React.ReactElement {
  const exportJson = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const [patchText, setPatchText] = useState("");
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewBase, setPreviewBase] = useState("");

  function downloadBackup(): void {
    const url = URL.createObjectURL(new Blob([exportJson], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `baoyan-applications-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function previewImport(text: string): void {
    try {
      const input = JSON.parse(text);
      if (input?.schema === APPLICATION_TRACKER_SCHEMA) {
        const nextData = validateApplicationData(input);
        setPreview({ nextData, appliedCount: nextData.records.length, errors: [], summary: [
          `用备份的 ${nextData.records.length} 条记录替换当前 ${data.records.length} 条申请。建议先下载当前备份。`
        ] });
      } else {
        setPreview(previewApplicationPatch(data, parseApplicationPatch(input)));
      }
      setPreviewBase(exportJson);
      setError(null);
    } catch (previewError) {
      setPreview(null);
      setError(previewError instanceof Error ? previewError.message : "导入文件解析失败");
    }
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    if (file.size > 5_000_000) { setError("文件超过 5 MB，请检查是否选择了申请备份 JSON。"); return; }
    try {
      const text = await file.text();
      setPatchText(text);
      previewImport(text);
    } catch { setError("文件读取失败，请重新选择。"); }
  }

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
    previewImport(patchText);
  }

  function applyPreview(): void {
    if (preview === null || preview.errors.length > 0) {
      return;
    }
    if (previewBase !== exportJson) {
      setError("申请数据已变化，请重新预览后再确认导入。");
      return;
    }
    if (!onReplaceData(preview.nextData)) {
      setError("保存失败，预览已保留。请检查本地存储后重试。");
      return;
    }
    setPatchText("");
    setPreview(null);
  }

  return (
    <section className="agent-panel" aria-label="备份与导入">
      <div className="agent-copy">
        <span className="section-kicker">数据工具</span>
        <h3>备份与导入</h3>
        <p>
          申请记录仅保存在当前浏览器。定期下载备份，换设备时可导入恢复；导入前先预览，不会立即覆盖。
        </p>
        <button className="chip chip-active" onClick={downloadBackup} type="button">
          <Download aria-hidden="true" size={16} />下载申请备份
        </button>
      </div>
      <div className="agent-grid">
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>当前申请 JSON</strong>
            <button className="icon-action" onClick={copyExport} type="button">
              <Copy aria-hidden="true" size={16} />
              {copied ? "已复制" : "复制 JSON"}
            </button>
          </div>
          <textarea aria-label="当前申请 JSON" readOnly rows={9} value={exportJson} />
        </div>
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>导入备份或 Patch</strong>
            <button className="icon-action" onClick={buildPreview} type="button">
              <Eye aria-hidden="true" size={16} />
              预览
            </button>
          </div>
          <label className="file-import">
            <Upload aria-hidden="true" size={16} />选择 JSON 文件
            <input aria-label="选择申请备份文件" accept=".json,application/json" type="file" onChange={(event) => {
              void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = "";
            }} />
          </label>
          <textarea
            aria-label="待导入 JSON"
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              setPatchText(event.currentTarget.value);
              setPreview(null);
              setError(null);
            }}
            placeholder={`{\n  "schema": "${APPLICATION_PATCH_SCHEMA}",\n  "operations": []\n}`}
            rows={9}
            value={patchText}
          />
          {error !== null && <p className="agent-error" role="alert">{error}</p>}
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
                    确认导入
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
