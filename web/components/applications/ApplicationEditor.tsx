import { ExternalLink, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import type {
  ActivityType,
  ApplicationEvent,
  ApplicationEventType,
  ApplicationMaterial,
  ApplicationPriority,
  ApplicationRecord,
  ApplicationResult,
  ApplicationStatus,
  MaterialStatus
} from "../../applicationTracker";
import {
  ACTIVITY_TYPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  RESULT_OPTIONS,
  STATUS_OPTIONS
} from "../../constants";
import {
  cloneApplicationRecord,
  formatEventType,
  serializeEditableRecord
} from "../../utils/applications";
import { dateTimeIsoToLocal, dateTimeLocalToIso, formatEventDate } from "../../utils/datetime";

export function ApplicationEditor({
  onClose,
  onRemoveRecord,
  onUpdateRecord,
  record
}: {
  onClose: () => void;
  onRemoveRecord: (id: string) => void;
  onUpdateRecord: (id: string, values: Partial<ApplicationRecord>) => void;
  record: ApplicationRecord | null;
}): React.ReactElement | null {
  const [draft, setDraft] = useState<ApplicationRecord | null>(null);
  const [baseline, setBaseline] = useState<ApplicationRecord | null>(null);
  const [newEventType, setNewEventType] = useState<ApplicationEventType>("interview");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventNote, setNewEventNote] = useState("");
  const [saved, setSaved] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const hasChanges =
    draft !== null && baseline !== null && serializeEditableRecord(draft) !== serializeEditableRecord(baseline);
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;

  useEffect(() => {
    const nextRecord = record === null ? null : cloneApplicationRecord(record);
    setDraft(nextRecord);
    setBaseline(nextRecord === null ? null : cloneApplicationRecord(nextRecord));
    setNewEventType("interview");
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventNote("");
    setSaved(false);
  }, [record?.id]);

  useEffect(() => {
    if (record === null) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Tab") {
        const focusable = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) ?? []
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first !== undefined && last !== undefined) {
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (!hasChangesRef.current || window.confirm("当前修改尚未保存，确定关闭吗？")) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [record?.id]);

  if (record === null || draft === null) {
    return null;
  }
  const activeRecord = draft;

  function requestClose(): void {
    if (hasChanges && !window.confirm("当前修改尚未保存，确定关闭吗？")) {
      return;
    }
    onClose();
  }

  function updateDraft(values: Partial<ApplicationRecord>): void {
    setSaved(false);
    setDraft((current) => (current === null ? current : { ...current, ...values }));
  }

  function updateMaterial(material: ApplicationMaterial, status: MaterialStatus): void {
    updateDraft({
      materials: activeRecord.materials.map((entry) =>
        entry.id === material.id ? { ...entry, status } : entry
      )
    });
  }

  function removeEvent(eventId: string): void {
    updateDraft({
      events: activeRecord.events.filter((event) => event.id !== eventId)
    });
  }

  function addEvent(): void {
    const title = newEventTitle.trim();
    if (title === "" || newEventDate.trim() === "") {
      return;
    }
    const event: ApplicationEvent = {
      id: `event-${Date.now().toString(36)}`,
      type: newEventType,
      title,
      date: dateTimeLocalToIso(newEventDate),
      note: newEventNote.trim()
    };
    updateDraft({ events: [...activeRecord.events, event] });
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventNote("");
  }

  function saveChanges(): void {
    if (!hasChanges) {
      return;
    }
    onUpdateRecord(activeRecord.id, activeRecord);
    setBaseline(cloneApplicationRecord(activeRecord));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function deleteApplication(): void {
    if (!window.confirm(`确定删除“${activeRecord.school}”的申请记录吗？`)) {
      return;
    }
    onRemoveRecord(activeRecord.id);
    onClose();
  }

  return (
    <div className="application-drawer-layer">
      <button aria-label="关闭申请详情" className="drawer-backdrop" onClick={requestClose} type="button" />
      <aside
        aria-labelledby="application-editor-title"
        aria-modal="true"
        className="application-editor"
        ref={drawerRef}
        role="dialog"
      >
        <header className="editor-head">
          <div>
            <span className="section-kicker">APPLICATION DETAIL</span>
            <h3 id="application-editor-title">{activeRecord.school}</h3>
            <p>{activeRecord.institute || "未提供院系"}</p>
          </div>
          <div className="editor-head-actions">
            <span className="tier-badge">{activeRecord.tier}</span>
            <button
              aria-label="关闭申请详情"
              className="icon-button"
              onClick={requestClose}
              ref={closeButtonRef}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </div>
        </header>

        <div className="editor-scroll">
          <section className="editor-section" aria-labelledby="editor-basic-title">
            <div className="editor-section-title">
              <span>01</span>
              <h4 id="editor-basic-title">基本信息</h4>
            </div>
            <div className="editor-form-grid editor-form-grid-two">
              <label className="text-field">
                <span>学校</span>
                <input value={activeRecord.school} onChange={(event) => updateDraft({ school: event.currentTarget.value })} />
              </label>
              <label className="text-field">
                <span>院系或项目</span>
                <input value={activeRecord.institute} onChange={(event) => updateDraft({ institute: event.currentTarget.value })} />
              </label>
              <label className="text-field">
                <span>官方通知</span>
                <input
                  inputMode="url"
                  placeholder="https://"
                  type="url"
                  value={activeRecord.website}
                  onChange={(event) => updateDraft({ website: event.currentTarget.value })}
                />
              </label>
              <label className="text-field">
                <span>截止时间</span>
                <input
                  type="datetime-local"
                  value={dateTimeIsoToLocal(activeRecord.deadlineAt)}
                  onChange={(event) => {
                    const deadlineAt = dateTimeLocalToIso(event.currentTarget.value);
                    updateDraft({ deadlineAt, deadlineText: formatEventDate(deadlineAt) });
                  }}
                />
              </label>
              <label className="select-field">
                <span>项目类型</span>
                <select
                  value={activeRecord.activityType}
                  onChange={(event) => updateDraft({ activityType: event.currentTarget.value as ActivityType })}
                >
                  {ACTIVITY_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="editor-section" aria-labelledby="editor-progress-title">
            <div className="editor-section-title">
              <span>02</span>
              <h4 id="editor-progress-title">申请进度</h4>
            </div>
            <div className="editor-fields">
              <label className="select-field">
                <span>状态</span>
                <select
                  value={activeRecord.status}
                  onChange={(event) => updateDraft({ status: event.currentTarget.value as ApplicationStatus })}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>优先级</span>
                <select
                  value={activeRecord.priority}
                  onChange={(event) => updateDraft({ priority: event.currentTarget.value as ApplicationPriority })}
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>结果</span>
                <select
                  value={activeRecord.result}
                  onChange={(event) => updateDraft({ result: event.currentTarget.value as ApplicationResult })}
                >
                  {RESULT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="editor-section material-panel" aria-labelledby="editor-material-title">
            <div className="editor-section-title">
              <span>03</span>
              <h4 id="editor-material-title">材料清单</h4>
            </div>
            <div className="material-list">
              {activeRecord.materials.map((material) => (
                <div className="material-row" key={material.id}>
                  <label className="material-checkbox">
                    <input
                      checked={material.status === "done"}
                      disabled={material.status === "not_required"}
                      onChange={(event) => updateMaterial(material, event.currentTarget.checked ? "done" : "todo")}
                      type="checkbox"
                    />
                    <span>{material.label}</span>
                  </label>
                  <button
                    aria-pressed={material.status === "not_required"}
                    className={material.status === "not_required" ? "material-skip material-skip-active" : "material-skip"}
                    onClick={() => updateMaterial(material, material.status === "not_required" ? "todo" : "not_required")}
                    type="button"
                  >
                    {material.status === "not_required" ? "恢复待办" : "不需要"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="editor-section events-panel" aria-labelledby="editor-events-title">
            <div className="editor-section-title">
              <span>04</span>
              <h4 id="editor-events-title">关键日期</h4>
            </div>
            <div className="event-list">
              {activeRecord.events.length === 0 ? (
                <p className="empty-hint">暂无日程。</p>
              ) : (
                activeRecord.events
                  .slice()
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map((event) => (
                    <div className="event-row" key={event.id}>
                      <span className={`event-type event-${event.type}`}>{formatEventType(event.type)}</span>
                      <div>
                        <strong>{event.title}</strong>
                        <span>{formatEventDate(event.date)}{event.note === "" ? "" : ` · ${event.note}`}</span>
                      </div>
                      <button aria-label={`删除日程 ${event.title}`} onClick={() => removeEvent(event.id)} title="删除日程" type="button">
                        <Trash2 aria-hidden="true" size={16} />
                      </button>
                    </div>
                  ))
              )}
            </div>
            <div className="event-form">
              <select
                aria-label="日程类型"
                value={newEventType}
                onChange={(event) => setNewEventType(event.currentTarget.value as ApplicationEventType)}
              >
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                aria-label="日程名称"
                value={newEventTitle}
                onChange={(event) => setNewEventTitle(event.currentTarget.value)}
                placeholder="日程名称"
                type="text"
              />
              <input
                aria-label="日程时间"
                value={newEventDate}
                onChange={(event) => setNewEventDate(event.currentTarget.value)}
                type="datetime-local"
              />
              <input
                aria-label="日程备注"
                value={newEventNote}
                onChange={(event) => setNewEventNote(event.currentTarget.value)}
                placeholder="备注"
                type="text"
              />
              <button className="secondary-action event-add-button" onClick={addEvent} type="button">
                <Plus aria-hidden="true" size={17} />
                添加日程
              </button>
            </div>
          </section>

          <section className="editor-section" aria-labelledby="editor-notes-title">
            <div className="editor-section-title">
              <span>05</span>
              <h4 id="editor-notes-title">结果与备注</h4>
            </div>
            <label className="notes-field">
              <span>备注</span>
              <textarea
                value={activeRecord.notes}
                onChange={(event) => updateDraft({ notes: event.currentTarget.value })}
                placeholder="记录导师、材料要求、面试准备和结果。"
                rows={6}
              />
            </label>
            <button className="danger-action editor-delete" onClick={deleteApplication} type="button">
              <Trash2 aria-hidden="true" size={16} />
              删除申请记录
            </button>
          </section>
        </div>

        <footer className="editor-savebar">
          <span aria-live="polite">
            {saved ? "已保存到当前浏览器" : hasChanges ? "有未保存的修改" : "本地数据已保存"}
          </span>
          <div>
            {activeRecord.website.trim() !== "" && (
              <a className="secondary-action" href={activeRecord.website} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />
                官方通知
              </a>
            )}
            <button className="secondary-action" onClick={requestClose} type="button">关闭</button>
            <button className="primary-action" disabled={!hasChanges} onClick={saveChanges} type="button">
              <Save aria-hidden="true" size={17} />
              保存修改
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
