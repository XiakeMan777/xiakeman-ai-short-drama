# API 配置

社区版默认不提供共享 Key。所有模型服务都需要用户或部署管理员自行配置。

## 两套设置域

### 主工作流 API 设置

入口：页面右上角“API 设置”，源码为 `src/components/shared/ApiSettingsModal.tsx`。

保存行为：

- 总是保存到当前浏览器项目状态。
- 社区前台不提供账号登录，不会把 LLM、图片、视频、TTS 或音乐配置同步到账号接口。
- 浏览器配置文件的其他使用者可能读取这些 Key，因此不要在共享电脑上保存私人密钥。

### Canvas 设置

入口：节点画布内部设置，源码为 `src/features/canvas/compat/SettingsDialog.tsx` 和 `stores/settingsStore.ts`。

Canvas 支持新增自定义 provider 和不同节点能力，但其配置与主工作流独立。主工作流中保存一个模型不会自动覆盖 Canvas provider，反之亦然。

## 对话模型

必填项：

- API 地址，例如 `https://provider.example/v1`
- API Key
- 模型名

客户端会在 API 地址后调用 `/chat/completions`。如果地址已经包含反向代理前缀，应保证拼接后的地址仍是有效的 OpenAI Chat Completions 路由。

BFF 的 `/api/chat/completions` 不接受任意系统提示词；它根据 `templateType` 在服务端装配模板。生产环境通过 `LLM_BASE_URL_ALLOWLIST` 限制允许访问的上游域名。

## 图片模型

必填项是 API 地址、Key、模型名；尺寸和质量按模型可选。

协议自动识别规则位于 `src/lib/imageApiClient.ts`：

- 地址或模型符合 OpenAI Images 时调用 `/images/generations` 或 `/images/edits`。
- 火山 Seedream 调用 `/api/v3/images/generations`。
- APIMart 异步模型提交后轮询任务。
- Xiakeman/Artlist 兼容地址使用 license header 和异步任务接口。
- 其他情况回落到 Gemini 内容生成格式。

由于识别依赖地址和模型名，自建兼容网关应先做单张、低分辨率测试。后台图片任务用 `IMAGE_BASE_URL_ALLOWLIST` 控制上游；未单独设置时继承 `LLM_BASE_URL_ALLOWLIST`。

## 视频模型

| 通道 | 需要的配置 | 运行依赖 |
| --- | --- | --- |
| 本地 Seedance | 本地服务地址/默认开发代理 | 另行运行兼容服务 |
| Seedance 兼容云端 | 服务地址、许可证、模型 | 上游支持提交、余额和轮询协议 |
| 小云雀 Agent | Agent 地址、Access Key | 可访问的小云雀 Agent 服务 |
| 火山方舟 | Base URL、API Key、Seedance 模型 | 火山方舟官方接口 |
| 阿里云百炼 | API Key、区域、HappyHorse 模型 | DashScope/百炼接口 |

公共参数包括画幅、时长和分辨率。不同模型允许的组合不同，保存时会归一化不支持的值。

`hmapi` 只剩类型和迁移兼容，不在当前设置入口中，不应作为社区版现成功能宣传。

## 语音与音效

语音设置调用当前 MiMo TTS 兼容格式，地址后拼接 `/chat/completions`，可测试连接。声音克隆需要可用的参考音频数据；声音设计需要明确的文本描述。

ElevenLabs 音效和转写使用自身 `/sound-generation`、`/speech-to-text` 路由。相关 Key 不应写进源码或公共环境示例。

## 浏览器直连与自托管后台

浏览器直连适合个人本机使用，优点是配置简单；限制是：

- Key 存在浏览器存储中，同一浏览器配置文件的使用者可以读取。
- 上游必须允许浏览器 CORS。
- 无法隐藏请求参数和模型地址。

自托管 BFF 仍保留后台协议，但社区前台不提供账号配置入口：

- 部署者需要自行接入认证和模型配置后，worker 才能代用户调用上游。
- 必须配置上游白名单，防止自定义地址被利用访问服务器内网。

## 地址白名单

生产环境至少设置：

```dotenv
LLM_BASE_URL_ALLOWLIST=api.openai.com,provider.example
IMAGE_BASE_URL_ALLOWLIST=image-provider.example
TTS_BASE_URL_ALLOWLIST=tts-provider.example
MUSIC_BASE_URL_ALLOWLIST=music-provider.example
XYQ_AGENT_BASE_ALLOWLIST=xyq.jianying.com
```

值是逗号分隔的主机名，不要填路径或 API Key。开发环境允许更多地址；生产环境在未配置白名单时仍会拒绝 localhost 和私网主机，但显式白名单更易审计。

## 上线前检查

1. 用无余额或低配额测试 Key 验证一次 LLM、图片、视频和语音。
2. 刷新页面，确认当前浏览器中的本地设置能够恢复。
3. 检查浏览器网络面板，确认 Key 没有发往错误域名。
4. 检查后台日志不输出 Authorization、Cookie 或完整 Key。
5. 在生产环境收紧 CORS、上游白名单和反向代理访问范围。
