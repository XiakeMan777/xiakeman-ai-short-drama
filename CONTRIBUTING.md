# 参与贡献

## 以源码为准

修改功能或文档前，先从真实入口追踪调用链：

- 前端：`src/main.tsx` → `src/App.tsx`
- BFF：`bff/server.js` → 挂载 router/handler
- 独立入口：package scripts、Electron、Docker、SQL migration

不要根据旧 README、交接文档或文件名判断功能是否存在。

## 提交原则

- 变更保持小而可验证，不混入无关格式化。
- 不提交 API Key、Cookie、数据库 URL、对象存储密钥、真实用户数据或内部地址。
- 新 provider 必须允许用户/管理员配置，不能把共享密钥打进前端包。
- 删除文件前检查静态 import、动态 import、字符串路径、package scripts 和后端挂载。
- 带有 `legacy`/`deprecated` 的迁移字段只有在确认不再读取后才能删除。
- 功能状态变化时同步更新 `docs/FEATURES.md` 和 `docs/KNOWN_LIMITATIONS.md`。

## 本地检查

```powershell
npm ci
npm ci --prefix bff
npm run encoding:check
npm run build
npm audit
npm audit --prefix bff
```

BFF 变更还要执行所有 `bff/*.js` 和 `bff/templates/*.js` 的 `node --check`，启动服务并请求 `GET /api/health`。

UI 或状态变更至少用新浏览器上下文验证首页、API 设置保存/刷新和受影响工作台，记录控制台错误。真实付费 API 验证使用低额度测试 Key，且不得把 Key 或响应中的个人数据写进截图、日志和提交。

## 不要提交生成物

依赖、构建、运行数据和验证产物应保持在 `.gitignore` 之外：

- `node_modules/`、`bff/node_modules/`
- `dist/`、`.desktop-package/`、`.docker-bff/`
- `.env`、数据库、日志、运行数据、媒体输出
- 浏览器自动化缓存和临时验证目录
