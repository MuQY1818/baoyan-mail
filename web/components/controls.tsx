import { LayoutGrid, Table2 } from "lucide-react";
import type React from "react";
import type { ViewMode } from "../types";

export function FilterSegment({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
}): React.ReactElement {
  return (
    <div className="control-block filter-segment">
      <div className="control-label">{label}</div>
      <div className="segmented-control" aria-label={label} role="group">
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? "segment-button segment-button-active" : "segment-button"}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ViewSwitcher({
  onChange,
  value
}: {
  onChange: (value: ViewMode) => void;
  value: ViewMode;
}): React.ReactElement {
  return (
    <div className="view-switcher" aria-label="显示方式" role="group">
      <button
        aria-label="卡片视图"
        aria-pressed={value === "cards"}
        className={value === "cards" ? "view-button view-button-active" : "view-button"}
        onClick={() => onChange("cards")}
        title="卡片视图"
        type="button"
      >
        <LayoutGrid aria-hidden="true" size={18} />
      </button>
      <button
        aria-label="表格视图"
        aria-pressed={value === "table"}
        className={value === "table" ? "view-button view-button-active" : "view-button"}
        onClick={() => onChange("table")}
        title="表格视图"
        type="button"
      >
        <Table2 aria-hidden="true" size={18} />
      </button>
    </div>
  );
}

export function StateMessage({
  actionLabel,
  message,
  onAction,
  title
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}): React.ReactElement {
  return (
    <section className="state-message">
      <h2>{title}</h2>
      <p>{message}</p>
      {actionLabel !== undefined && onAction !== undefined && (
        <button className="chip chip-active" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </section>
  );
}
