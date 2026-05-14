# 虾客漫 Xiakeman

虾客漫是一套面向 AI 漫剧、短剧和漫画视频生产的seedance2.0专用创作工作台，帮助创作者把点子、小说或剧本推进到角色资产、分镜提示词、视频生成、配音字幕和成片合成。

在线体验：<https://xiakeman.com/>

## 适合谁

- 短剧、漫剧、漫画视频创作者。
- 需要批量整理分镜、提示词、角色资产和镜头方案的团队。
- 想把 AI 视频生成流程做成稳定流水线的工作室。
- 想先本地部署试用，再接入自己模型和素材流程的开发/运营团队。

## 核心能力

- 剧本整理：把小说、点子或标注剧本整理为结构化生产素材。
- 角色资产：管理角色、场景、服装、道具和一致性引用。
- 分镜设计：生成镜头拆解、故事板、Shot Sheet 和视频提示词。
- 视频生成：对接本地或云端视频模型服务，支持批量任务流程。
- 配音字幕：整理台词、声线参考、TTS、字幕、音效和 BGM。
- 本地合成：通过 FFmpeg/ffprobe 生成成片素材包。

## 使用方式

### 在线版

推荐先体验在线版本：

<https://xiakeman.com/>

在线版更新最快，适合直接体验产品流程、演示能力和持续使用。

### Docker 部署版

适合本地服务器、内网环境或私有演示环境。

```bash
docker compose up -d --build
```

启动后打开：

```text
http://localhost:8022
```

BFF 健康检查：

```text
http://localhost:8030/api/health
```

如果你的对话模型接口运行在本机，例如 `http://127.0.0.1:54209/v1`，Docker 版会自动转到宿主机入口访问。页面里的 API 地址仍可按本机地址填写，API Key 只保存在你的本地浏览器配置里。

也可以直接使用 Docker：

```bash
docker build -t xiakeman-ai-short-drama:latest .
docker run -d --name xiakeman --add-host=host.docker.internal:host-gateway -p 8022:8022 -p 8030:8030 xiakeman-ai-short-drama:latest
```

停止服务：

```bash
docker stop xiakeman
docker rm xiakeman
```

### Windows 桌面版

Windows 桌面软件版请到 [GitHub Releases](https://github.com/XiakeMan777/xiakeman-ai-short-drama/releases) 下载。

推荐下载文件夹版：

- `Xiakeman-0.3.3-win-x64-folder.zip`
- SHA256：`64AF835E65890483D5D60E1AEAD8C45902AE39593E4524C7DD20FB6FF3D78359`

如果安全软件对单文件 exe 有误报，请优先使用文件夹版 zip。解压后运行里面的 `Xiakeman.exe`。

## 仓库内容

这个仓库提供可部署的运行包和发布说明，方便快速体验虾客漫。

- `web/`：网页应用运行文件。
- `server/`：本地服务运行文件。
- `voice_corpus/`：声线样本占位目录，默认不内置样本。
- `software/`：桌面软件版下载说明和校验信息。
- `Dockerfile`：Docker 镜像构建文件。
- `docker-compose.yml`：Docker Compose 启动配置。
- `nginx.conf`：容器内页面和接口转发配置。
- `start.sh`：容器启动脚本。

## 授权

本仓库内容保留所有权利。未经书面许可，不得复制、修改、二次分发、反编译、逆向工程或基于本发布包制作衍生产品。

商业合作、在线体验和最新版本请访问：<https://xiakeman.com/>
