# 工作台与数据可靠性升级

## 实现范围

本轮保留 React、Cloudflare Workers + D1、现有三源和浏览器本地申请数据。生产迁移、Cloudflare Secret、远端工作流更新及部署需要单独确认；本手册不是已上线声明。邮件继续关闭，`outputs/` 不参与本次变更。

### 前端

- 工作台统一灰白/蓝色和深色主题，正文 15px、辅助文字 13px；学校院系完整显示，日期用等宽数字。
- 搜索、项目类型、截止范围前置；桌面表格收敛为五组信息，手机卡片与底部筛选面板；时间线默认折叠。
- 结果数量、项目类型统计和截止摘要均来自当前筛选；保留“未标注”“待确认”“全部源站”入口。
- 卡片和表格共用截止可信度组件。只有日期时不展示虚构时分；来源冲突、未知截止、官方核验有独立说明。
- 手动刷新、20 秒请求超时、取消旧请求；刷新失败保留已加载列表。
- 申请、日历、地图按需加载。月历 `+N` 可展开全部，手机默认日程列表。
- 备份下载、文件或文本导入、变更预览和确认写入。UI 和 `window.BaoyanAgent` 使用统一存储入口；损坏数据、写入失败或其他页面更新均不静默覆盖。编辑器保存/删除失败保留草稿，未添加的日程输入也纳入未保存提醒。

### 后端

- 保研岛分页校验 total、一致性、页数、每页条数、重复/缺失 ID，未知截止项目继续保留。
- 采集前申请共享锁；每源和合并后的骤降检查同时在脚本和服务端执行。
- 主快照和审核候选一起 staging，数量一致才原子发布。重复相同上传幂等，不同内容复用 key 拒绝。
- 发布结果与 `snapshotVersion` 同事务保存。相同 `runId` 重试 finalize 返回原结果；发布后 abort 不撤销快照。
- 分类候选携带发布版本和内容指纹；写入、版本校验、反馈及幂等结果同事务提交。
- 已知通用报名门户与多个当前项目共用的链接不能写入 URL 级分类，保留待核验，避免跨批次传播。
- 运行状态可查询。watchdog 对并发、在途 workflow、30 分钟冷却和 dispatch 响应丢失做保护。

### D1 免费额度保护

- 暂存改为每 20 条一个 JSON 批次，保持全量 inventory 与审核池完整性检查。相同批次乱序重试不再写入；跨批重叠或内容不一致拒绝。
- 发布仅更新新增、内容变化和重新出现的项目；未变化项目不逐行刷新时间。消失判断使用本轮完整 inventory，公开 lastSeenAt 使用健康发布时刻。
- `pipeline_write_budget` 为采集和分类事务预留保守成本，默认每天 60000，可通过 `PIPELINE_DAILY_WRITE_BUDGET` 下调。包含索引、批次清理等余量，**不是 Cloudflare 账户实时计费数**；其他数据库、访问统计和管理操作仍会消耗账户额度。
- 超预算返回 429 `pipeline_write_budget_exhausted`，事务回滚，保留健康快照；采集不立即重试。分类应保存未处理清单，等 `writeBudget.resetsAt` 后再运行。每天 UTC 00:00，即北京时间 08:00 开始新预算。
- 当日已经收到用量告警时，管理员可预先占用当日预算的一部分，确保新版本不会错误地把剩余额度当成全天额度。不要通过删除历史项目、反馈或快照来“退回”日用量；删除本身也计入写入。
- 生产备份本地回放：4576 条历史快照和 6585 条反馈保留；2387 条活动项目变为 120 行暂存批次，未变快照更新 0 行，整个暂存/发布/清理共 487 个 SQLite 行变更（不含 D1 索引计费），保守预留 1504。真实 D1 用量须上线后从 insights/meta 核对。

## 分类协议 v2

所有管理接口继续要求管理员认证。生产自动化只使用本地既有认证助手，不读取/打印凭据内容，不将认证文件放进仓库。

1. 查询 `GET /api/admin/source-health`，确认 `protocolVersion >= 2`，获取 `snapshotVersion`。核实源统计与最近健康发布时间；过期先走统一补同步流程。
2. 首次 `POST /api/admin/verification-candidates` 发送 `{"runId":"ai-unique-run","limit":100}`。后续保持同一 `runId`、`limit` 和返回的 `snapshotVersion`，传回 `nextCursor`。直到接口明确 `nextCursor:null`，不能因页长小于 limit、异常空页或请求失败就认为结束。
3. 读取官方标题和正文，核实类型、相关度及最早影响资格的强制节点。不能从月份猜类型；反爬、空页和多批次歧义留在待重试清单。
4. 以下四个写回接口必须传同一外层结构，每批最多 100 条：`relevance-classifications`、`activity-type-classifications`、`official-verifications`、`classification-feedback`。

```json
{
  "snapshotVersion": "从本轮候选返回值逐字复制",
  "runId": "ai-unique-run",
  "submissionId": "ai-unique-run-kind-batch-1",
  "model": "gpt-5.6-luna",
  "targets": [{ "key": "候选 key", "contentHash": "候选 contentHash" }],
  "items": []
}
```

这里的 `items` 是结构示意，实际必须非空，内容格式见 README。`classifier`/`verifier` 必须等于实际执行的 `model`，不能虚报模型。每个 `itemKey` 必须匹配自己对应候选的官方链接。相同 `submissionId` 重试必须使用相同请求；更换内容必须使用新 ID。已完成提交重试返回原结果，即便之后又发生发布，也不会再次写入。

5. 调用 `POST /api/admin/classification-progress` 持久化进度：

```json
{
  "runId": "ai-unique-run",
  "snapshotVersion": "本轮发布版本",
  "model": "gpt-5.6-luna",
  "status": "partial",
  "processed": 25,
  "cursor": "下一页游标或 null",
  "paginationComplete": false,
  "retry": [{ "key": "待复核项目 key", "reason": "官方页面反爬，未取得证据" }]
}
```

- `processed` 是已处理的不同候选数；服务端汇总的 `accepted` 是各写接口接收条数，同一项目可能写多类字段，二者不能当成相同口径。
- `feedbackWritten` / `written` 为事务内实际新增反馈数；语义重复不再追加，计数为 0。
- `status` 支持 `running / partial / failed / succeeded`。成功必须 `paginationComplete:true`、`cursor:null`、`retry:[]`，且服务端确有该 runId 的完整分页链，processed 不少于已分页候选数。
- 复查候选使用另一个 runId，避免覆盖原运行的分页凭证。同一次运行不能更改版本或模型。
- 409 `snapshot_version_changed` / `candidate_content_changed`：停止旧批写回，重新读取版本和证据；不要盲目重试。
- 409 `shared_classification_url` / `ambiguous_classification_url`：保留类型/相关度待核验；DDL 可通过现有 itemKey 官方核验接口逐项目处理，不把 URL 标签强行传播到其他批次。
- 409 `idempotency_key_reused`：同幂等键使用了不同请求，检查进度文件，不能覆盖旧结果。
- 429 `pipeline_write_budget_exhausted`：停止本轮写入及补采集重试，保留进度和失败通知；健康快照不受影响，下一预算日继续。
- 428 `versioned_submission_required`：客户端协议未升级；500/网络超时也不能当成写入成功，重试必须复用原 submissionId。

`GET /api/admin/pipeline-runs` 返回最近 30 条运行。逻辑 `run_id` 用于串联补同步、staging、发布和分类；`workflow_run_id` 是 GitHub 的数字运行 ID，返回时附目标仓库的运行链接。

## 本地验证

```bash
npm ci
npm run typecheck
npm test
npm run build:web
git diff --check
```

使用 Node.js 24；测试中的 `node:sqlite` 会提示实验特性，但不代表失败。`test/sqliteD1.ts` 在真实 SQLite 上应用全部迁移，并用事务模拟 D1 batch 回滚，覆盖发布响应丢失、审核候选缺失、锁丢失、过期分类、同 URL 多项目、反馈幂等等边界。

`test/ui.test.tsx` 覆盖筛选/统计、收藏、视图、日历展开、保存/删除失败、原生日期 input、损坏存储、并发页面写入、备份预览、刷新失败和 Agent 协议。CI 执行同样的类型检查、测试与前端构建。

本地开发前端的 `/api/ddl` 默认代理到 `127.0.0.1:8787`，可通过 `DDL_DEV_API_URL` 指向独立本地模拟服务。此环境变量仅用于开发，不改变生产 API 或真实浏览器申请数据。

## 发布顺序（确认后执行）

1. 暂停采集和本地分类，确认没有在途任务，备份 D1 和旧部署标识。不要先 push 新采集脚本到仍使用旧 Worker 的生产链路。
2. 对目标 D1 应用添加式 `0012_pipeline_reliability.sql` 和 `0013_write_efficiency.sql`。使用真实部署配置核对数据库绑定；仓库 `wrangler.toml` 的 D1 ID 是占位值，不能直接部署。0012 的反馈唯一索引仅覆盖非空 key，避免给旧 NULL 反馈建立无用索引。
3. 部署新版 Worker，保持 `SOURCE_WATCHDOG_ENABLED=false`。公开 `/api/ddl` 保持兼容；管理分类写入升级为 v2，旧写入请求会被拒绝。这不是旧管理写接口的无缝兼容升级。
4. 更新现有本地认证助手白名单，新增 claim/request/pipeline-runs/classification-progress；不得放宽任意 URL/路径访问。原自动化按 `protocolVersion` 选择旧/新协议，保持原 ID、每天 08:00、`gpt-5.6-luna / high`、仅失败通知。
5. 推送新采集脚本和 Actions 工作流，手动运行一次并检查三源统计、审核池、发布结果、version、GitHub run ID，确认分页闭环；恢复正常小时任务。
6. 部署前端到现有 Vercel 项目，检查公开 API 与实际页面的缓存版本；再运行一轮分类验证和回读。不要新建替代站点。
7. 最后配置 Cloudflare Secret `GITHUB_ACTIONS_TOKEN`，使用仅针对目标仓库的 fine-grained token，Actions 读/写权限用于查询运行与 workflow dispatch；无需 Contents 写权限。凭据通过 Secret 工具安全输入，不写入配置、文档或命令历史。确认普通变量 `GITHUB_REPOSITORY`、`GITHUB_SYNC_WORKFLOW`、`GITHUB_SYNC_REF` 正确，再启用 `SOURCE_WATCHDOG_ENABLED=true`。
8. 核验北京时间白天、90 分钟阈值、在途锁和冷却；观察一次受控补采集闭环后，才宣告云端兜底可用。任何一步失败保留上一健康快照并报告原因。

定时规则为 GitHub `17 0-15 * * *`（北京时间 08:17-23:17）和 Cloudflare `*/15 * * * *`（只在北京时间 08:00-23:59 允许自动补触发）。它们不是实时保证。AI 分类仍依赖本地自动化宿主、网络及官方页面可读性；云端兜底只保障采集。

## 回滚

1. 先关闭 watchdog，并暂停 Actions 及本地分类，避免新旧协议并行。
2. 按记录恢复旧 Worker 和旧采集工作流/脚本，再恢复旧前端部署。自动化须重新读取 source-health；若回到旧协议，走已有兼容分支。
3. 添加式新表/索引保留，不执行删表或反向数据覆盖。不要删除快照、反馈和运行历史。
4. 抽查公开 DDL、来源健康、未知截止入口及本地申请读写，再恢复调度。密钥撤销/轮换需独立确认。

## 验收证据与限制

本轮在独立本地 origin 使用显式“演示·”数据，覆盖精确时间、仅日期、来源冲突、未知截止、未标注和长院系名。未将这些演示记录上传，也未读取或修改线上申请存储。

2026-09-05 本地验证：类型检查通过，5 个测试文件、194 项测试全部通过，前端构建、`git diff --check` 和本地认证助手语法检查通过。主入口约 263.61 kB（gzip 83.74 kB），申请和日历已分为独立 chunk。

截图保存在仓库被忽略的 `artifacts/ui-review-2026-09-05/`，已逐张保存并重新打开检查。验收步骤与证据如下：

| 步骤 | 实际检查与结果 | 截图 |
| --- | --- | --- |
| 1. 查找项目 | 1440px 深/浅表格、768px 深/浅表格、375px 深/浅卡片正常；长院系名可读，日期精度和冲突提示明确。平板保留局部横向滚动提示。 | `01-desktop-light.png`、`02-desktop-dark.png`、`04-mobile-dark.png`、`05-tablet-dark.png`、`06-tablet-light.png`、`07-mobile-light.png`、`16-mobile-top-light.png` |
| 2. 搜索和筛选 | 空搜索结果与统计同时变为 0，清除后恢复 6 条演示记录；手机面板可关闭，Escape 后焦点回到高级筛选按钮。 | `03-mobile-filters-dark.png`、`08-mobile-empty.png` |
| 3. 管理申请和日程 | 加入演示申请、保存备注、添加三条同日面试均成功；修复日期 input 未触发状态更新的问题；手机日程无文字溢出，月历展开可看到四条同日事件。 | `09-mobile-editor.png`、`10-mobile-agenda.png`、`11-calendar-expanded.png` |
| 4. 备份和导入 | 备份 JSON 可见，文本 Patch 先预览再确认，确认后回读到新增备注。真实浏览器文件下载和文件选择导入尚未单独验收，相关解析/存储由单测覆盖。 | `12-import-preview.png` |
| 5. 请求异常与恢复 | 模拟 503 刷新失败仍保留 6 条项目；首次失败提供重新加载，重试时有骨架屏，随后恢复 6 条。演示服务已恢复正常响应。 | `13-refresh-failure.png`、`14-initial-error.png`、`15-loading.png` |

原 `baoyan-mail-ddl-ai` 已通过自动化工具更新并复核，仍为每天 08:00、`gpt-5.6-luna / high`、仅失败通知；本地认证助手白名单同步更新。此处只证明配置已保存，不代表新版生产分类闭环已执行。

地图保留独立延迟加载的约 1.89 MB chunk，构建仍报告体积警告；未为了消除警告改换三维技术栈。这不是全 WCAG 审计，也不是生产数据完整性背书。全量生产采集、真实 D1 执行限制、线上部署缓存和夜间/白天真实调度必须在发布阶段验证。没有专用 GitHub Secret 时云端兜底保持关闭。
