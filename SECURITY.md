# 安全说明

虾客漫会接触模型 API Key、创作素材和生成结果。无论是本机使用还是自行部署，都请先保护好这些数据。

## 本机使用

- API Key 默认保存在当前浏览器中，只在自己的可信设备上保存。
- 填写服务地址前确认域名正确，Key 会发送到这个地址。
- 不要把 Key 放进源码、`.env.example`、截图、Issue 或群聊。
- 定期导出重要项目；清理浏览器数据可能删除未备份的内容。
- 不再使用的 Key 应及时在服务商后台撤销或更换。

## 自己部署

- 使用 HTTPS，并把 `CORS_ORIGIN` 设置为确切的网站地址。
- 使用稳定的长随机值配置 `AUTH_SECRET`、`APP_SETTINGS_SECRET` 或 `SETTINGS_ENCRYPTION_KEY`。
- 只允许服务器访问确实需要的模型域名，不要向普通用户开放 localhost、云元数据地址或内网管理接口。
- 为媒体代理、上传、渲染和模型请求设置速率、大小与超时限制。
- 如果不使用保留的账号、管理、云项目和 Agent 接口，请在反向代理层限制它们，并设置 `AUTH_ALLOW_REGISTRATION=false`。
- 日志不要记录 Authorization、Cookie、完整 Key、原始密码或私人素材地址。
- 数据库、对象存储、数据目录和加密密钥应一起备份；只备份数据而丢失加密密钥，可能无法恢复已保存的密钥。

更多部署边界见 [部署指南](docs/DEPLOYMENT.md) 和 [BFF HTTP API](docs/HTTP_API.md)。

## Google Analytics

首页保留 Google Analytics 页面访问统计，用于了解项目的实际使用量。项目代码不会把模型 API Key、模型配置或项目正文作为统计内容主动发送。需要完全离线的自行部署者，可以在自己的分支中移除 `index.html` 里的统计脚本。

## 报告安全问题

请优先使用 GitHub 的 [私密安全报告](https://github.com/XiakeMan777/xiakeman-ai-short-drama/security/advisories/new)。如果该入口不可用，再提交不包含敏感细节的 Issue，请维护者与你私下联系。

报告中可以提供受影响的页面或接口、复现步骤、可能的影响和脱敏后的错误信息。不要提交可用凭据、真实用户数据、未公开素材或可直接利用的生产环境细节。
