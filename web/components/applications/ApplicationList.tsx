import { ArrowUpRight, ExternalLink } from "lucide-react";
import type React from "react";
import type { ApplicationRecord } from "../../applicationTracker";
import {
  formatApplicationRemaining,
  formatApplicationStatus,
  formatMaterialProgress,
  formatPriority,
  formatResult
} from "../../utils/applications";
import { formatEventDate } from "../../utils/datetime";

export function ApplicationTable({
  activeRecordId,
  records,
  onChooseRecord
}: {
  activeRecordId: string | null;
  records: ApplicationRecord[];
  onChooseRecord: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="table-wrap application-table-wrap">
      <table className="ddl-table application-table">
        <thead>
          <tr>
            <th>学校</th>
            <th>院系</th>
            <th>DDL</th>
            <th>状态</th>
            <th>优先级</th>
            <th>材料</th>
            <th>结果</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              className={activeRecordId === record.id ? "application-row-active" : ""}
              key={record.id}
            >
              <td>{renderApplicationOfficialLink(record, record.school)}</td>
              <td>{renderApplicationOfficialLink(record, record.institute || "未提供院系", true)}</td>
              <td>
                <strong>{formatApplicationRemaining(record)}</strong>
                <span>{record.deadlineText || formatEventDate(record.deadlineAt)}</span>
                {record.website.trim() !== "" && (
                  <a
                    className="application-inline-source"
                    href={record.website}
                    rel="noreferrer"
                    target="_blank"
                  >
                    官方通知
                  </a>
                )}
              </td>
              <td><span className={`status-pill status-${record.status}`}>{formatApplicationStatus(record.status)}</span></td>
              <td>{formatPriority(record.priority)}</td>
              <td>{formatMaterialProgress(record.materials)}</td>
              <td>{formatResult(record.result)}</td>
              <td>
                <div className="table-actions">
                  <button onClick={() => onChooseRecord(record.id)} type="button">
                    <ArrowUpRight aria-hidden="true" size={15} />
                    编辑
                  </button>
                  {record.website !== "" && (
                    <a href={record.website} rel="noreferrer" target="_blank" title="官方通知">
                      <ExternalLink aria-hidden="true" size={15} />
                      官方通知
                    </a>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApplicationCards({
  activeRecordId,
  records,
  onChooseRecord
}: {
  activeRecordId: string | null;
  records: ApplicationRecord[];
  onChooseRecord: (id: string) => void;
}): React.ReactElement {
  return (
    <ol className="application-card-list">
      {records.map((record) => (
        <li
          className={activeRecordId === record.id ? "application-card application-card-active" : "application-card"}
          key={record.id}
        >
          <div className="application-card-main">
            <span className={`status-pill status-${record.status}`}>{formatApplicationStatus(record.status)}</span>
            <h3>{renderApplicationOfficialLink(record, record.school)}</h3>
            <p>{renderApplicationOfficialLink(record, record.institute || "未提供院系", true)}</p>
          </div>
          <dl className="application-card-meta">
            <div>
              <dt>DDL</dt>
              <dd>{formatApplicationRemaining(record)}</dd>
            </div>
            <div>
              <dt>优先级</dt>
              <dd>{formatPriority(record.priority)}</dd>
            </div>
            <div>
              <dt>材料</dt>
              <dd>{formatMaterialProgress(record.materials)}</dd>
            </div>
          </dl>
          <button className="icon-action" onClick={() => onChooseRecord(record.id)} type="button">
            <ArrowUpRight aria-hidden="true" size={17} />
            编辑申请
          </button>
        </li>
      ))}
    </ol>
  );
}

function renderApplicationOfficialLink(
  record: ApplicationRecord,
  label: string,
  muted = false
): React.ReactElement {
  const trimmedLabel = label.trim() || "未提供";
  if (record.website.trim() === "") {
    return <span>{trimmedLabel}</span>;
  }
  return (
    <a
      className={muted ? "application-record-link application-record-link-muted" : "application-record-link"}
      href={record.website}
      rel="noreferrer"
      target="_blank"
      title={`${record.school} ${record.institute || ""} - 打开官方通知`}
    >
      {trimmedLabel}
    </a>
  );
}
