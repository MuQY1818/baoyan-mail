import { ChevronDown, Database, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type {
  ApplicationPriority,
  ApplicationRecord,
  ApplicationResult,
  ApplicationStatus,
  ApplicationTrackerData
} from "../../applicationTracker";
import {
  APPLICATION_RANGE_OPTIONS,
  MOBILE_VIEW_MEDIA_QUERY,
  PRIORITY_OPTIONS,
  RESULT_OPTIONS,
  STATUS_OPTIONS
} from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type {
  ApplicationRangeFilter,
  ApplicationStorageIssue,
  ApplicationViewMode,
  ViewMode
} from "../../types";
import { buildApplicationStats, filterApplicationRecords } from "../../utils/applications";
import { persistViewMode, readStoredViewMode } from "../../utils/storage";
import { FilterSegment, StateMessage, ViewSwitcher } from "../controls";
import { AgentDataPanel } from "./AgentDataPanel";
import { ApplicationEditor } from "./ApplicationEditor";
import { ApplicationCards, ApplicationTable } from "./ApplicationList";
import { StorageRecoveryBanner } from "./StorageRecoveryBanner";

export function ApplicationWorkspace({
  activeRecordId,
  data,
  onRemoveRecord,
  onReplaceData,
  onResetStorage,
  onSelectRecord,
  onUpdateRecord,
  storageIssue
}: {
  activeRecordId: string | null;
  data: ApplicationTrackerData;
  onRemoveRecord: (id: string) => void;
  onReplaceData: (data: ApplicationTrackerData) => void;
  onResetStorage: () => void;
  onSelectRecord: (id: string | null) => void;
  onUpdateRecord: (id: string, values: Partial<ApplicationRecord>) => void;
  storageIssue: ApplicationStorageIssue | null;
}): React.ReactElement {
  const isMobileViewport = useMediaQuery(MOBILE_VIEW_MEDIA_QUERY);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | "all">("all");
  const [priority, setPriority] = useState<ApplicationPriority | "all">("all");
  const [result, setResult] = useState<ApplicationResult | "all">("all");
  const [range, setRange] = useState<ApplicationRangeFilter>("all");
  const [viewMode, setViewMode] = useState<ApplicationViewMode>(() =>
    readStoredViewMode("application", isMobileViewport)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const previousMobileViewport = useRef(isMobileViewport);
  const records = useMemo(
    () => filterApplicationRecords(data.records, { priority, query, range, result, status }),
    [data.records, priority, query, range, result, status]
  );
  const stats = useMemo(() => buildApplicationStats(data.records), [data.records]);
  const activeRecord = data.records.find((record) => record.id === activeRecordId) ?? null;
  const advancedFilterCount =
    Number(priority !== "all") + Number(result !== "all") + Number(range !== "all");

  useEffect(() => {
    if (previousMobileViewport.current === isMobileViewport) {
      return;
    }
    previousMobileViewport.current = isMobileViewport;
    setViewMode(readStoredViewMode("application", isMobileViewport));
  }, [isMobileViewport]);

  function changeViewMode(nextViewMode: ViewMode): void {
    setViewMode(nextViewMode);
    persistViewMode("application", isMobileViewport, nextViewMode);
  }

  function resetApplicationFilters(): void {
    setQuery("");
    setStatus("all");
    setPriority("all");
    setResult("all");
    setRange("all");
  }

  return (
    <section className="application-shell" aria-label="我的申请">
      <header className="workspace-intro application-intro">
        <div>
          <span className="section-kicker">APPLICATION DESK</span>
          <h2>我的申请</h2>
          <p>投递状态、材料进度和面试日程只保存在当前浏览器。</p>
        </div>
        <div className="application-head-actions">
          <button
            aria-expanded={agentOpen}
            className={agentOpen ? "secondary-action secondary-action-active" : "secondary-action"}
            onClick={() => setAgentOpen((value) => !value)}
            type="button"
          >
            <Database aria-hidden="true" size={17} />
            数据工具
            <ChevronDown aria-hidden="true" className={agentOpen ? "chevron-open" : ""} size={16} />
          </button>
          <span className="local-badge">仅存本地</span>
        </div>
      </header>

      {storageIssue !== null && (
        <StorageRecoveryBanner issue={storageIssue} onReset={onResetStorage} />
      )}

      <section className="application-metrics" aria-label="申请概览">
        <ApplicationMetric label="全部申请" value={stats.total} />
        <ApplicationMetric label="准备中" value={stats.preparing} />
        <ApplicationMetric label="已投递" value={stats.submitted} />
        <ApplicationMetric label="待处理" tone="attention" value={stats.pendingAction} />
      </section>

      {agentOpen && <AgentDataPanel data={data} onReplaceData={onReplaceData} />}

      <section className="application-toolbar" aria-label="申请筛选">
        <label className="search-field application-search">
          <span>搜索申请</span>
          <div className="search-control">
            <Search aria-hidden="true" size={19} />
            <input
              value={query}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
              placeholder="学校、院系或备注"
              type="search"
            />
          </div>
        </label>
        <label className="select-field">
          <span>当前状态</span>
          <select
            value={status}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setStatus(event.currentTarget.value as ApplicationStatus | "all")
            }
          >
            <option value="all">全部状态</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          aria-expanded={advancedOpen}
          className={advancedOpen ? "secondary-action secondary-action-active" : "secondary-action"}
          onClick={() => setAdvancedOpen((value) => !value)}
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" size={17} />
          更多条件
          {advancedFilterCount > 0 && <span className="action-count">{advancedFilterCount}</span>}
          <ChevronDown aria-hidden="true" className={advancedOpen ? "chevron-open" : ""} size={16} />
        </button>
        <div className="application-toolbar-result">
          <strong>{records.length}</strong>
          <span>条记录</span>
        </div>
        <ViewSwitcher onChange={changeViewMode} value={viewMode} />

        <div className={advancedOpen ? "application-advanced application-advanced-open" : "application-advanced"}>
          <label className="select-field">
            <span>优先级</span>
            <select
              value={priority}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setPriority(event.currentTarget.value as ApplicationPriority | "all")
              }
            >
              <option value="all">全部优先级</option>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>申请结果</span>
            <select
              value={result}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setResult(event.currentTarget.value as ApplicationResult | "all")
              }
            >
              <option value="all">全部结果</option>
              {RESULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <FilterSegment
            label="截止范围"
            onChange={(value) => setRange(value as ApplicationRangeFilter)}
            options={APPLICATION_RANGE_OPTIONS}
            value={range}
          />
          {advancedFilterCount > 0 && (
            <button className="clear-filter-button application-filter-clear" onClick={resetApplicationFilters} type="button">
              <RotateCcw aria-hidden="true" size={14} />
              清除筛选
            </button>
          )}
        </div>
      </section>

      <section className="application-list-panel" aria-label="申请列表">
        {records.length === 0 ? (
          <StateMessage
            title="还没有符合条件的申请"
            message={data.records.length === 0 ? "从 DDL 列表里点击加入申请后，这里会生成本地记录。" : "调整筛选条件后再试。"}
          />
        ) : viewMode === "table" ? (
          <ApplicationTable
            activeRecordId={activeRecord?.id ?? null}
            records={records}
            onChooseRecord={onSelectRecord}
          />
        ) : (
          <ApplicationCards
            activeRecordId={activeRecord?.id ?? null}
            records={records}
            onChooseRecord={onSelectRecord}
          />
        )}
      </section>

      <ApplicationEditor
        onClose={() => onSelectRecord(null)}
        record={activeRecord}
        onRemoveRecord={onRemoveRecord}
        onUpdateRecord={onUpdateRecord}
      />
    </section>
  );
}

function ApplicationMetric({
  label,
  tone = "normal",
  value
}: {
  label: string;
  tone?: "normal" | "attention";
  value: number;
}): React.ReactElement {
  return (
    <div className={tone === "attention" ? "application-metric application-metric-attention" : "application-metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
