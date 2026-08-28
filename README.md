# 保研 DDL 查询网站数据服务

![保研 DDL 查询网站数据服务 Hero 图](docs/assets/hero.png)

一个部署在 Cloudflare Workers 上的保研 DDL 数据服务。系统在北京时间白天每小时交叉拉取保研信息平台、星刻保研和保研岛的公开数据，按官方通知链接进行保守合并；公开网站默认展示 AI 判定的计算机类强相关条目，并保留可能相关和全部源站切换。
当前项目只维护网站和公开 API，DDL 邮件推送已经关闭。

## 功能

- 邮件推送已经关闭，新的订阅和确认入口返回停用提示；历史退订链接仍然有效。
- 北京时间 08:00-23:00 每小时同步多个公开源，公开 API 返回合并后的未截止条目、AI 相关度、项目类型、来源集合和 DDL 可信度状态。
- 网站按 `Top2`、`华五`、`C9`、`985`、`211`、`其他` 展示互斥学校层次；来源和方向不写入标签。
- 使用 D1 保存数据快照、AI 相关度分类、官方标题项目类型分类、官方 DDL 核验、审核候选和访问统计。
- 提供公开 DDL 查询 API 和 Vercel 前端网站，默认展示强相关未截止项目，并支持切换可能相关或全部源站。
- DDL API 会标记源站可见性，默认隐藏已截止和超过 48 小时宽限期的 stale 条目。
- 提供候选审核和人工补充能力，用户提交的缺漏链接审核通过后再公开。
- DDL 查询网站支持项目类型、相关度、方向、层次、时间、来源筛选，支持 URL 分享、最近新增/更新、收藏、已读、紧凑表格和白昼/夜间模式。
- DDL 查询网站底部展示匿名访问统计，按浏览器每日一次计数，聚合近 30 天访问、国家或地区、细分地区和趋势，不保存 IP、邮箱或浏览器指纹。
- 管理员可手动运行外部同步脚本，使用与 GitHub Actions 相同的抓取、合并、数量保护和原子发布流程。

## 架构

```text
GitHub Actions（北京时间 08:00-23:00 每小时）
  -> 并行拉取保研信息平台、星刻保研、保研岛
  -> 规范化官方链接、保守合并、校验每源健康与数量骤降
  -> 分批写入 Cloudflare Worker staging 表并原子发布到 D1

Luna High（北京时间每天 08:30）
  -> 分页读取待核验候选
  -> 访问官方通知，回写相关度、项目类型和精确 DDL

用户浏览器 -> Vercel 网站 -> Cloudflare Worker 公开 API -> D1
```

数据源：

```text
https://www.baoyanxinxi.cn/2026jsjby/
https://xingkebaoyan.com/data.json
https://api.zscampus.com/zs-baoyan-summer/summer/getListWithConditions
```

只接入可公开读取的源，并应遵循各站公开规则。条目始终跳转到官方通知；聚合页只承担发现和交叉校验，不作为最终 DDL 证据。

## 技术栈

- Cloudflare Workers
- Cloudflare D1
- GitHub Actions
- TypeScript
- Vite + React
- Vitest

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 数据服务说明页 |
| `POST` | `/api/subscribe` | 已停用，返回邮件推送关闭提示 |
| `GET` | `/api/confirm?token=...` | 已停用，返回邮件推送关闭提示 |
| `GET` | `/api/unsubscribe?token=...` | 退订 |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/ddl` | 公开 DDL 列表，供前端网站读取 |
| `POST` | `/api/analytics/visit` | 记录一次匿名聚合访问 |
| `GET` | `/api/analytics/summary` | 获取近 30 天匿名访问统计 |
| `GET` | `/api/admin/run-check` | 已停用的旧 Worker 抓取入口，返回 `409 external_sync_required` |
| `GET` | `/api/admin/sync-sources` | 已停用的旧 Worker 抓取入口，返回 `409 external_sync_required` |
| `GET` | `/api/admin/source-health` | 返回最近一次多源同步健康统计，需要管理员密钥 |
| `POST` | `/api/admin/verification-candidates` | 分页返回需要官方核验的条目及原因，需要管理员密钥 |
| `POST` | `/api/admin/relevance-classifications` | 批量写入 AI 相关度分类，需要管理员密钥 |
| `POST` | `/api/admin/activity-type-classifications` | 批量写入官方标题项目类型分类，需要管理员密钥 |
| `POST` | `/api/admin/official-verifications` | 批量写入官方页面核验的标题和 DDL，需要管理员密钥 |
| `GET` | `/api/admin/review` | 候选审核页面，需要管理员审核密码 |

手动同步源站。脚本会在本机完成抓取与合并，再通过受保护的分批接口原子发布；`BAOYAN_ADMIN_TOKEN` 只从环境读取：

```bash
BAOYAN_SYNC_BASE_URL=https://baoyan.example.com \
  npm run sync:sources:external
```

写入 AI 相关度分类：

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"items":[{"website":"https://example.com/notice","relevance":"strong","areas":["计算机"],"reason":"院系明确为计算机学院","classifier":"codex-ai"}]}' \
  https://baoyan.example.com/api/admin/relevance-classifications
```

写入项目类型分类：

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"items":[{"website":"https://example.com/notice","activityType":"pre_recommendation","reason":"官方标题明确写有推荐免试研究生预报名","classifier":"codex-official-title"}]}' \
  https://baoyan.example.com/api/admin/activity-type-classifications
```

写入官方页面核验结果。`deadlinePrecision` 为 `exact` 时表示官方页面给出了具体时间；只有日期时用 `date`：

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"items":[{"itemKey":"snapshot-item-key","website":"https://example.com/notice","title":"2027年接收推免生预报名通知","deadline":"2026-09-10 17:00","deadlinePrecision":"exact","reason":"官方通知正文明确写明报名截止时间","verifier":"luna-high"}]}' \
  https://baoyan.example.com/api/admin/official-verifications
```

## 本地开发

安装依赖：

```bash
npm install
```

创建本地 D1 表：

```bash
npm run db:migrate:local
```

创建 `.dev.vars`，该文件只保存在本地，不要提交：

```dotenv
ADMIN_TOKEN=replace-with-a-long-random-string
ADMIN_REVIEW_PASSWORD=replace-with-review-password
APP_BASE_URL=http://localhost:8787
```

启动开发服务：

```bash
npm run dev
```

访问：

```text
http://localhost:8787/
```

启动 DDL 查询网站：

```bash
npm run dev:web
```

Vite 会将 `/api/ddl` 代理到本地 Worker。开发前需要同时运行 `npm run dev`。

## Cloudflare 部署

创建 D1 数据库：

```bash
npx wrangler d1 create baoyan-mail-db
```

把输出的 `database_id` 写入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "baoyan-mail-db"
database_id = "your-d1-database-id"
```

应用远程迁移：

```bash
npm run db:migrate:remote
```

设置生产密钥：

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ADMIN_REVIEW_PASSWORD
```

修改 `wrangler.toml` 中的非敏感变量：

```toml
APP_BASE_URL = "https://baoyan.example.com"
```

抓取源地址属于外部同步脚本配置，可在 GitHub Actions 或本地运行时通过 `BAOYANXINXI_SOURCE_URL`、`BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL`、`XINGKE_SOURCE_URL`、`ZSCAMPUS_SOURCE_URL` 和 `SOURCE_YEAR` 覆盖；未设置时使用内置公开地址和上海时区当前年份。

部署：

```bash
npm run deploy
```

如果使用自定义域名，需要先在 Cloudflare 中接入对应 zone，再为 Worker 配置 route 或 custom domain。

## DDL 查询网站

网站使用 Vite + React + TypeScript，入口在 `web/`，构建产物输出到 `dist/`。页面默认展示强相关未截止 DDL，支持切换强相关、强相关+可能、全部源站，也支持夏令营、预推免、未标注项目类型筛选、学校或院系搜索、方向筛选、学校层次筛选、时间范围筛选、来源筛选、最近新增/更新、收藏、已读、紧凑表格、白昼/夜间模式和原始通知跳转。

网站底部展示匿名访问统计，风格采用轻量 analytics footer：指标卡、抽象地球热力、地区排行和 30 天趋势。统计写入 D1 `visit_daily_stats`，按北京时间日期聚合；生产访问优先读取 Vercel 地区请求头，回退到 Cloudflare `request.cf` 地理信息。

构建：

```bash
npm run build:web
```

Vercel 部署使用 `vercel.json`，其中 `/api/ddl` 和 `/api/analytics/*` 会转发到生产 Worker：

```text
https://baoyan-mail.weijuebu.workers.dev/api/ddl
```

## 定时任务

系统有两条定时链路：

- GitHub Actions 在北京时间 08:00-23:00 每小时整点运行 `npm run sync:sources:external`。每个来源独立抓取；任一源失败、为空或相对上一轮数量异常骤降时整轮停止，不会发布半套数据，也不会把旧条目标记为消失。仓库需要配置 Actions Secret `BAOYAN_ADMIN_TOKEN`。
- Luna High 自动化每天北京时间 09:30 检查 `/api/admin/source-health` 的最新同步时间和各源统计，再分页读取 `/api/admin/verification-candidates`。它只访问官方通知并写回相关度、夏令营/预推免类型和官方 DDL，不再负责抓取聚合站。同一通知有多个节点时，主 DDL 取最早会导致申请资格失效的强制截止时间；后续材料或确认时间不得覆盖更早的系统报名截止。旧核验和晚于源数据的核验会继续进入复核队列。
- 没有明确截止时间的当前项目不会从公开 API 消失，而是以 `status=unknown`、`deadlineText=待确认` 返回；网站可通过“待确认”时间筛选单独查看。

Worker 不再配置 Cloudflare Cron，也不在请求或定时事件中执行重型抓取；这是为了适配 Cloudflare Free Worker 的 CPU 限制。

## 更新检测规则

- 将学校、院系、标题、截止时间、官方链接、来源观测、学校层次和方向分类标准化为通知记录。
- 默认自动源为保研信息平台、星刻保研和保研岛；各源单独抓取，使用 `Promise.allSettled` 隔离故障。独立预推免页面仍可通过 `BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL` 增加。
- 一级合并使用规范化官方链接，移除 fragment、`scene`、`click_id`、`utm_*` 等追踪参数。同一具体官方通知链接且学校、院系一致时直接合并；通用报名门户不作为强身份。链接不同的记录只有在学校、院系、截止日和标题同时高度一致时才保守合并，并进入审核池。
- 合并结果保留 `sourceGroups`、每个源的原始 DDL、时间精度、备用链接和冲突状态；不会只留下一个无法追溯的来源。
- DDL 字段按“官方核验 > 人工审核 > 明确时间 > 日期级默认时间”选择。多源 DDL 不一致时保留冲突并等待官方核验，不静默覆盖。
- 每源同步统计包含抓取量、有效量、源内重复、跨源重合、独有发现、冲突数、页数和最新发布时间，可通过 `/api/admin/source-health` 查看。
- 项目类型只依据独立源配置、历史 source group、明确文本标记或官方通知标题与正文识别，不根据截止月份推断；无法确认的记录显示为“未标注”。
- Luna High 项目类型分类按规范化官方链接写入 D1，并优先于源站弱标签；新条目、来源冲突或官方通知更新后需要重新核验。
- 自动源不再按专业方向过滤公开网站数据，源站中可解析且未截止的条目会进入公开 API，由用户在前端选择方向筛选。
- Codex AI 分类按规范化原始链接写入 D1，`relevance` 固定为 `strong`、`possible`、`unrelated`；`areas` 固定为方向集合中的一个或多个值。
- `/api/ddl` 有 AI 分类时优先使用 AI 分类，没有分类时回退到规则分类；网站默认只展示 `strong`，用户可以切换查看 `possible` 或全部源站。
- 方向分类包括计算机、软件、人工智能、网络安全、电子信息、通信、集成电路、自动化控制、数据科学、机器人光电和其他。
- 用户提交的缺漏链接先进入候选池，审核通过后作为人工补充公开。
- 学校层次只作为网站展示标签，不参与服务端过滤；展示分类固定为 `Top2`、`华五`、`C9`、`985`、`211`、`其他`。
- 使用规范化官方链接生成稳定身份；上线新算法时会按已有快照链接复用旧 key，避免本地申请、收藏和已读状态失联。
- 每轮上传先写 staging 表；只有条数与本地合并结果完全一致才原子发布。中断运行不会污染公开快照，24 小时前的遗留 staging 行会在下一轮回收。
- 每次同步会记录 `last_seen_at`。只有完整同步成功且条目不再被任何来源返回时，才会标记 `missing_since`。公开 API 对未来 DDL 提供 48 小时宽限显示，超过宽限期后默认隐藏。
- DDL 邮件队列表和历史邮件日志保留历史数据，新逻辑不再写入或发送 DDL 推送邮件。

## 测试

运行类型检查和单元测试：

```bash
npm run typecheck
npm test
npm run build:web
```

本地模拟同步流程：

1. 应用本地 D1 迁移并启动 Worker。
2. 准备三个源的 HTML 或 JSON 测试夹具，并通过脚本环境变量覆盖源地址。
3. 设置本地 `BAOYAN_SYNC_BASE_URL` 与 `BAOYAN_ADMIN_TOKEN`，运行 `npm run sync:sources:external`。
4. 检查脚本输出的 `sourceStats`、`scanned`、`reviewCandidates` 和 `missingCount`。
5. 检查 `/api/ddl` 的 `lastSyncedAt`、`sourceGroups`、`deadlineConflict`、项目类型和来源筛选。

本地模拟 AI 分类写入：

1. 运行外部同步脚本，确认三个源健康且不会发送邮件。
2. 调用 `/api/admin/verification-candidates` 获取待核验条目。
3. 按以下标准生成分类：`strong` 为计算机、软件、AI、网安、电子信息、通信、集成电路、自动化控制、数据科学、机器人、光电信息等明确相关；`possible` 为系统、智能、交互、遥感、仪器、电气、量子信息等可能相关但标题不明确；`unrelated` 为心理学、医学、公共卫生、生命、生物、材料、化学、经管、金融、法学、教育、建筑、土木、农学等明显无关。
4. 通过 `/api/admin/relevance-classifications` 写回分类。
5. 再次调用 `/api/ddl`，确认返回 `relevance`、`relevanceReason` 和覆盖后的 `areas`。

本地模拟项目类型分类写入：

1. 调用 `/api/ddl`，选择 `activityTypeSource` 为 `unknown` 或更新时间晚于分类时间的条目。
2. 打开官方通知链接，只依据官方标题或正文中的夏令营、暑期活动、推荐免试或预推免等明确表述分类。
3. 通过 `/api/admin/activity-type-classifications` 写回 `summer_camp`、`pre_recommendation` 或 `unknown`。
4. 再次调用 `/api/ddl`，确认 `activityTypeSource` 为 `classification`，并核对 `activityTypeReason`、`activityTypeClassifier` 和 `activityTypeClassifiedAt`。

## 安全说明

- 不要提交 `.dev.vars`、Cloudflare API token、GitHub token 或管理员密钥。
- 生产密钥应使用 Cloudflare Secrets 管理。
- 如果任何密钥曾经出现在聊天、日志、截图或公开仓库中，应立即轮换。
- 公开仓库中的 `APP_BASE_URL` 和 `database_id` 应使用占位值，部署时再替换为真实值。

## 许可证

本项目使用 MIT License，详见 [LICENSE](LICENSE)。
