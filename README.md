# 保研夏令营邮件订阅系统

![保研夏令营邮件订阅系统 Hero 图](public/assets/hero.png)

一个部署在 Cloudflare Workers 上的轻量邮件订阅系统。用户提交邮箱并确认订阅后，系统每天定时拉取
`CS-BAOYAN-DDL` 的 `schools.json`，并接入保研信息平台作为补充源，生成每日 DDL 汇总和新增 DDL 提醒，
通过阿里云邮件推送发送邮件。

## 功能

- 邮箱订阅、确认订阅和一键退订。
- 每日定时同步 CS-BAOYAN-DDL 主数据源。
- 接入保研信息平台 `2026 计算机保研` 页面作为补充源，并按计算机、电子信息相关方向筛选。
- 邮件按 `Top2`、`华五`、`C9`、`985`、`211`、`其他` 展示互斥学校层次；来源和方向不写入标签。
- 使用 D1 保存订阅者、数据快照和通知发送记录。
- 首次运行只初始化快照，不群发历史数据。
- 首次启用补充源时只初始化该源快照，不群发历史新增和历史 DDL。
- 每天发送未来 15 天 DDL 完整汇总；没有未来 15 天 DDL 时不发送。
- 系统首次发现带未来 DDL 的通知时发送一次新增 DDL 提醒；同一通知不重复提醒。
- 提供公开 DDL 查询 API 和 Vercel 前端网站，默认展示未截止项目并支持筛选。
- DDL API 会标记源站可见性，默认隐藏已截止和超过 48 小时宽限期的 stale 条目。
- 提供候选审核池和缺漏链接提交入口，边界方向人工审核通过后再公开。
- DDL 查询网站支持 URL 分享筛选、最近新增/更新、收藏、已读、紧凑表格和 `.ics` 日历导出。
- 每封邮件包含数据来源、原始通知链接和退订链接。
- 管理员可手动触发一次更新检查。

## 架构

```text
用户浏览器
  -> Cloudflare Worker 订阅页面和 API
  -> Cloudflare D1 保存订阅状态和快照
  -> Cron 每天触发更新检查
  -> 拉取 CS-BAOYAN-DDL schools.json 和保研信息平台补充源
  -> 筛选计算机、电子信息相关方向并跨源去重
  -> 生成每日 DDL 汇总和新增 DDL 提醒邮件
  -> 阿里云 DirectMail 发送邮件
```

数据源：

```text
https://raw.githubusercontent.com/CS-BAOYAN/CS-BAOYAN-DDL/main/src/data/schools.json
https://www.baoyanxinxi.cn/2026jsjby/
```

## 技术栈

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Cron Triggers
- 阿里云邮件推送 DirectMail
- TypeScript
- Vitest

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 订阅页面 |
| `POST` | `/api/subscribe` | 提交邮箱并发送确认邮件 |
| `GET` | `/api/confirm?token=...` | 确认订阅 |
| `GET` | `/api/unsubscribe?token=...` | 退订 |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/ddl` | 公开 DDL 列表，供前端网站读取 |
| `GET` | `/api/admin/run-check` | 手动触发检查，需要管理员密钥 |
| `GET` | `/api/admin/sync-sources` | 只同步源站和候选池，不发邮件，需要管理员密钥 |
| `GET` | `/api/admin/review` | 候选审核页面，需要管理员审核密码 |
| `POST` | `/api/missing-link` | 用户提交缺漏链接，进入候选池 |

手动触发检查：

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://baoyan.example.com/api/admin/run-check
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
ALIYUN_ACCESS_KEY_ID=your-access-key-id
ALIYUN_ACCESS_KEY_SECRET=your-access-key-secret
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

## 阿里云邮件推送配置

1. 开通阿里云邮件推送 DirectMail。
2. 添加并验证发信域名，例如 `example.com`。
3. 按控制台提示添加 SPF、DKIM、TXT、DMARC 等 DNS 记录。
4. 创建发信地址，例如 `notify@example.com`。
5. 创建 RAM AccessKey，并授予调用邮件推送接口所需权限。
6. 将 AccessKey 写入 Cloudflare Secrets 或本地 `.dev.vars`。

Worker 使用阿里云 RPC API 的 `SingleSendMail` 接口发信，不依赖阿里云 Node SDK。

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
npx wrangler secret put ALIYUN_ACCESS_KEY_ID
npx wrangler secret put ALIYUN_ACCESS_KEY_SECRET
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ADMIN_REVIEW_PASSWORD
```

修改 `wrangler.toml` 中的非敏感变量：

```toml
APP_BASE_URL = "https://baoyan.example.com"
BAOYANXINXI_SOURCE_URL = "https://www.baoyanxinxi.cn/2026jsjby/"
ALIYUN_DM_ACCOUNT_NAME = "notify@example.com"
SENDER_NAME = "保研通知"
BATCH_SIZE = "50"
```

部署：

```bash
npm run deploy
```

如果使用自定义域名，需要先在 Cloudflare 中接入对应 zone，再为 Worker 配置 route 或 custom domain。

## DDL 查询网站

网站使用 Vite + React + TypeScript，入口在 `web/`，构建产物输出到 `dist/`。页面默认展示未截止 DDL，支持学校或院系搜索、学校层次筛选、时间范围筛选、来源筛选、最近新增/更新、收藏、已读、紧凑表格、日历导出和原始通知跳转。

构建：

```bash
npm run build:web
```

Vercel 部署使用 `vercel.json`，其中 `/api/ddl` 会转发到生产 Worker：

```text
https://baoyan-mail.weijuebu.workers.dev/api/ddl
```

## 定时任务

`wrangler.toml` 默认配置：

```toml
[triggers]
crons = ["0 1 * * *"]
```

Cloudflare Cron 使用 UTC 时间。`0 1 * * *` 对应北京时间每天 09:00。

## 更新检测规则

- 将学校、院系、标题、截止时间、链接和展示标签标准化为通知记录。
- CS-BAOYAN-DDL 是主结构源；保研信息平台作为补充源，默认 URL 可通过 `BAOYANXINXI_SOURCE_URL` 覆盖。
- 补充源只保留计算机、软件、人工智能、网安、电子信息、通信、集成电路、自动化、控制、数据科学等相关方向。
- 补充源会过滤医学、生命、生物、材料、化学、经管、金融、法学、教育、心理、建筑、土木、农学等明显无关方向。
- 被过滤但命中科学智能、交互、信息、电子、系统、遥感、电气、仪器、物联网、量子等边界关键词的未来条目会进入候选池，审核通过后作为人工补充公开。
- 学校层次只作为邮件展示标签，不参与筛选；展示分类固定为 `Top2`、`华五`、`C9`、`985`、`211`、`其他`。
- 跨源使用规范化原始链接去重，去掉 `scene`、`click_id`、`utm_*` 等追踪参数；同一链接保留主源身份，补充源可修正 deadline。
- 使用稳定 key 识别同一条通知。
- 每次同步会记录 `last_seen_at`；成功抓取后源站消失的条目会标记 `missing_since`，公开 API 对未来 DDL 提供 48 小时宽限显示，超过宽限期后默认隐藏。
- 对比上一轮快照，识别首次发现且带未来 DDL 的通知。
- 首次运行只保存快照，不发送历史通知。
- 已有主源快照时，首次启用保研信息平台补充源只写入该源快照并记录 `app_state` 键 `baoyanxinxi2026jsjby`，不发送历史新增和该源历史 DDL。
- 未来 15 天 DDL 汇总为空时不发送汇总邮件；当天已经发送过完整汇总时不重复发送。
- 没有首次发现的未来 DDL 时不发送新增 DDL 邮件。
- 没有 active 订阅者时，通知会被标记为已处理，避免后续新订阅者收到历史积压。
- 每日 DDL 汇总会解析可用截止时间，忽略空值、`暂无`、`待定` 和已过期截止时间。
- 每日 DDL 汇总按北京时间日历日计算，包含未来 15 天内所有未截止 DDL；同一北京时间日期只发送一次。
- 新增 DDL 提醒按 `item_key` 去重；旧通知的 deadline 变化不会单独提醒，但会出现在每日完整汇总中。
- 旧的 15、7、3、1 窗口提醒队列表保留历史数据，新逻辑不再写入。

## 测试

运行类型检查和单元测试：

```bash
npm run typecheck
npm test
npm run build:web
```

本地模拟更新流程：

1. 使用真实数据源初始化本地快照。
2. 准备一份临时 JSON 数据源，在其中追加一条模拟通知。
3. 临时在 `.dev.vars` 中设置 `SOURCE_URL` 指向模拟数据源。
4. 调用 `/api/admin/run-check`。
5. 检查返回值中 `newDeadlineDetected` 是否大于 `0`，并确认 active 订阅者收到新增 DDL 邮件。
6. 测试结束后删除 `.dev.vars` 中的 `SOURCE_URL`。

本地模拟每日 DDL 汇总流程：

1. 应用本地 D1 迁移，确保存在 `new_deadline_notifications` 表。
2. 准备一份临时 JSON 数据源，让其中一条通知的 `deadline` 落在当前北京时间未来 15 天内。
3. 临时在 `.dev.vars` 中设置 `SOURCE_URL` 指向模拟数据源。
4. 调用 `/api/admin/run-check`。
5. 检查返回值中的 `dailyDeadlineDetected` 和 `dailyDeadlineSent`，并确认 active 订阅者收到未来 15 天 DDL 汇总邮件。
6. 再次调用 `/api/admin/run-check`，确认同一北京时间日期不会重复发送完整汇总。

本地模拟补充源流程：

1. 准备一段保研信息平台 HTML 片段，包含 `<h2>` 学校标题、`<p>` 通知和 `span.deadline[data-deadline]`。
2. 临时在 `.dev.vars` 中设置 `BAOYANXINXI_SOURCE_URL` 指向该 HTML。
3. 调用 `/api/admin/run-check`。
4. 检查返回值中的 `sourceStats`，确认原始条数、筛选条数、去重条数和初始化状态。
5. 首次启用时确认 `sourceStats` 中补充源 `initializedThisRun` 为 `true`，且历史新增和历史 DDL 不会发送。

## 安全说明

- 不要提交 `.dev.vars`、Cloudflare API token、GitHub token、阿里云 AccessKey 或管理员密钥。
- 生产密钥应使用 Cloudflare Secrets 管理。
- 如果任何密钥曾经出现在聊天、日志、截图或公开仓库中，应立即轮换。
- 公开仓库中的 `APP_BASE_URL`、发信地址和 `database_id` 应使用占位值，部署时再替换为真实值。

## 许可证

本项目使用 MIT License，详见 [LICENSE](LICENSE)。
