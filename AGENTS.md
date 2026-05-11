# AGENTS.md

## 项目约定

- 使用中文沟通。
- 代码保持简洁，遵循 Google Style 的命名和结构习惯。
- 不在代码、文档、提交信息中加入 Codex 署名。
- 不把任何 token、API key、密码写入仓库文件；生产密钥使用 Cloudflare Secrets。
- 安装 Python 包前必须确认不是 base 环境。本项目当前不是 Python 项目。
- 优先修改已有脚本和模块，避免无必要地增加文件。
- 不使用 emoji。

## 变更记录

- 2026-05-11：初始化 Cloudflare Workers + D1 + Brevo 邮件订阅系统，包含订阅确认、退订、定时拉取 CS-BAOYAN-DDL 数据、快照 diff、摘要邮件发送、D1 迁移、测试和部署文档。
- 2026-05-11：将邮件服务商从 Brevo 替换为阿里云邮件推送 DirectMail，新增 Worker 内 RPC 签名发送逻辑，发信地址和站点地址通过环境变量配置。
- 2026-05-11：修正阿里云 DirectMail `SingleSendMail` 的 `AddressType` 为 `0`，解决发信地址已创建但 API 返回 `InvalidMailAddress.NotFound` 的问题；同时修复异步路由异常未被统一中文错误页捕获的问题。
- 2026-05-11：升级保研通知摘要邮件模板，增加顶部摘要、通知卡片、标签、格式化截止时间、原始通知按钮和更清晰的数据来源/退订说明。
- 2026-05-11：完成本地模拟更新验证：先用真实 CS-BAOYAN-DDL 数据初始化快照，再切换到追加模拟记录的数据源，`run-check` 检测到 1 条新增并通过阿里云邮件推送发送摘要。
- 2026-05-11：完成 Cloudflare 生产部署验证，远程 D1、Worker 和 Cron 均可工作，Cron 为每天北京时间 09:00。
- 2026-05-11：按公开仓库发布要求完成本地配置和文档脱敏，README 改为通用部署文档，`wrangler.toml` 和测试夹具中的域名、发件地址、D1 id 改为占位值，准备发布到 GitHub。
- 2026-05-11：为 README 添加 Apple 风格纯白底 Hero 图资产，包含计算机保研通知元素和原创小煤球形象，仅用于仓库展示，不接入 Worker 页面。
