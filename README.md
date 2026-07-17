# 保研 DDL 查询网站数据服务

![保研 DDL 查询网站数据服务 Hero 图](docs/assets/hero.png)

一个部署在 Cloudflare Workers 上的保研 DDL 数据服务。系统在北京时间白天每小时拉取保研信息平台
`2026 计算机保研` 页面，公开网站默认展示 AI 判定的计算机类强相关条目，并保留可能相关和全部源站切换。
当前项目只维护网站和公开 API，DDL 邮件推送已经关闭。

## 功能

- 邮件推送已经关闭，新的订阅和确认入口返回停用提示；历史退订链接仍然有效。
- 北京时间 08:00-23:00 每小时同步保研信息平台 `2026 计算机保研` 页面，公开 API 保留源站未截止条目，并返回 AI 相关度和项目类型分类。
- 网站按 `Top2`、`华五`、`C9`、`985`、`211`、`其他` 展示互斥学校层次；来源和方向不写入标签。
- 使用 D1 保存数据快照、AI 相关度分类、官方标题项目类型分类、审核候选和访问统计。
- 提供公开 DDL 查询 API 和 Vercel 前端网站，默认展示强相关未截止项目，并支持切换可能相关或全部源站。
- DDL API 会标记源站可见性，默认隐藏已截止和超过 48 小时宽限期的 stale 条目。
- 提供候选审核和人工补充能力，用户提交的缺漏链接审核通过后再公开。
- DDL 查询网站支持项目类型、相关度、方向、层次、时间、来源筛选，支持 URL 分享、最近新增/更新、收藏、已读、紧凑表格和白昼/夜间模式。
- DDL 查询网站底部展示匿名访问统计，按浏览器每日一次计数，聚合近 30 天访问、国家或地区、细分地区和趋势，不保存 IP、邮箱或浏览器指纹。
- 管理员可手动触发一次只同步源站的更新检查。

## 架构

```text
用户浏览器
  -> Vercel DDL 查询网站
  -> Cloudflare Worker 公开 API
  -> Cloudflare D1 保存快照、相关度分类、项目类型分类、候选和访问统计
  -> Cron 白天每小时触发源站同步
  -> 拉取保研信息平台 2026 计算机保研页面
  -> 标准化源站条目、标注方向并去重
  -> 公开给 DDL 查询网站
```

数据源：

```text
https://www.baoyanxinxi.cn/2026jsjby/
```

## 技术栈

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Cron Triggers
- TypeScript
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
| `GET` | `/api/admin/run-check` | 兼容旧入口，只同步源站，不发邮件，需要管理员密钥 |
| `GET` | `/api/admin/sync-sources` | 只同步源站和候选池，不发邮件，需要管理员密钥 |
| `POST` | `/api/admin/relevance-classifications` | 批量写入 AI 相关度分类，需要管理员密钥 |
| `POST` | `/api/admin/activity-type-classifications` | 批量写入官方标题项目类型分类，需要管理员密钥 |
| `GET` | `/api/admin/review` | 候选审核页面，需要管理员审核密码 |

手动同步源站：

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://baoyan.example.com/api/admin/run-check
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
BAOYANXINXI_SOURCE_URL = "https://www.baoyanxinxi.cn/2026jsjby/"
# 可选：配置独立的预推免 HTML 或 JSON 转换源；未配置时不会按日期猜测预推免。
BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL = ""
```

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

- Codex 自动化每天北京时间 08:00 调用 `/api/admin/sync-sources` 同步源站，再读取 `/api/ddl`：增量条目做 AI 相关度分类，并读取官方标题或正文判定夏令营、预推免或未标注，分别写回相关度和项目类型分类接口；这一步不发邮件。
- Cloudflare Cron 每天北京时间 08:00-23:00 每小时整点运行 Worker `scheduled`，只同步源站快照、候选池和公开 API 所需状态，不发邮件。

`wrangler.toml` 默认配置：

```toml
[triggers]
crons = ["0 0-15 * * *"]
```

Cloudflare Cron 使用 UTC 时间。`0 0-15 * * *` 对应北京时间每天 08:00-23:00 每小时整点。

## 更新检测规则

- 将学校、院系、标题、截止时间、链接、学校层次和方向分类标准化为通知记录。
- 保研信息平台是默认自动数据源，默认 URL 可通过 `BAOYANXINXI_SOURCE_URL` 覆盖；该页面实际会混入夏令营和预推免通知，因此按混合源处理。独立预推免源可通过 `BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL` 增加。
- 项目类型只依据独立源配置、历史 source group、明确文本标记或官方通知标题与正文识别，不根据截止月份推断；无法确认的记录显示为“未标注”。
- Codex 项目类型分类按规范化官方链接写入 D1，并优先于源站弱标签；新条目或官方通知更新后才需要重新核验。
- 自动源不再按专业方向过滤公开网站数据，源站中可解析且未截止的条目会进入公开 API，由用户在前端选择方向筛选。
- Codex AI 分类按规范化原始链接写入 D1，`relevance` 固定为 `strong`、`possible`、`unrelated`；`areas` 固定为方向集合中的一个或多个值。
- `/api/ddl` 有 AI 分类时优先使用 AI 分类，没有分类时回退到规则分类；网站默认只展示 `strong`，用户可以切换查看 `possible` 或全部源站。
- 方向分类包括计算机、软件、人工智能、网络安全、电子信息、通信、集成电路、自动化控制、数据科学、机器人光电和其他。
- 用户提交的缺漏链接先进入候选池，审核通过后作为人工补充公开。
- 学校层次只作为网站展示标签，不参与服务端过滤；展示分类固定为 `Top2`、`华五`、`C9`、`985`、`211`、`其他`。
- 使用规范化原始链接去重，去掉 `scene`、`click_id`、`utm_*` 等追踪参数。
- 使用稳定 key 识别同一条通知。
- 每次同步会记录 `last_seen_at`；成功抓取后源站消失的条目会标记 `missing_since`，公开 API 对未来 DDL 提供 48 小时宽限显示，超过宽限期后默认隐藏。
- DDL 邮件队列表和历史邮件日志保留历史数据，新逻辑不再写入或发送 DDL 推送邮件。

## 测试

运行类型检查和单元测试：

```bash
npm run typecheck
npm test
npm run build:web
```

本地模拟同步流程：

1. 使用真实数据源初始化本地快照。
2. 准备一段新增通知的保研信息平台 HTML 片段。
3. 临时在 `.dev.vars` 中设置 `BAOYANXINXI_SOURCE_URL` 指向该 HTML。
4. 调用 `/api/admin/sync-sources` 或 `/api/admin/run-check`。
5. 检查返回值中的 `scanned`、`addedCount`、`changedCount`、`missingCount` 和 `lastSyncedAt`。
6. 测试结束后删除 `.dev.vars` 中的 `BAOYANXINXI_SOURCE_URL`。

本地模拟公开 DDL 流程：

1. 应用本地 D1 迁移，确保存在 `new_deadline_notifications` 表。
2. 准备一段保研信息平台 HTML 片段，让其中一条通知的 `data-deadline` 落在当前北京时间未来 15 天内。
3. 临时在 `.dev.vars` 中设置 `BAOYANXINXI_SOURCE_URL` 指向该 HTML。
4. 调用 `/api/admin/sync-sources`。
5. 检查 `/api/ddl` 返回的条目、`lastSyncedAt`、`sourceStats` 和 `stale` 统计。

本地模拟补充源流程：

1. 准备一段保研信息平台 HTML 片段，包含 `<h2>` 学校标题、`<p>` 通知和 `span.deadline[data-deadline]`。
2. 临时在 `.dev.vars` 中设置 `BAOYANXINXI_SOURCE_URL` 指向该 HTML。
3. 调用 `/api/admin/sync-sources`。
4. 检查返回值中的 `sourceStats`，确认原始条数、入库条数和去重条数。
5. 检查 `/api/ddl` 返回的 `areas` 字段，确认前端可按方向筛选。

本地模拟 AI 分类写入：

1. 调用 `/api/admin/sync-sources`，确认不会发送邮件。
2. 调用 `/api/ddl` 获取当前未截止条目。
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
