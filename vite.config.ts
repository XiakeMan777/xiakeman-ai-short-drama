import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "./package.json"), "utf-8"),
) as { version?: string }

function formatBuildTime(date: Date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

  return formatter.format(date)
}

const buildTime = formatBuildTime(new Date())
const appVersion = packageJson.version || "0.0.0"
const buildLabel = `${appVersion}+${buildTime.replace(/[-: ]/g, "")}`
function buildVersionManifestPlugin(): Plugin {
  return {
    name: "build-version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(
          {
            version: appVersion,
            buildTime,
            buildLabel,
          },
          null,
          2,
        ),
      })
    },
  }
}

function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined

  if (
    id.includes("node_modules/react/")
    || id.includes("node_modules/react-dom/")
    || id.includes("node_modules/scheduler/")
  ) {
    return "vendor-react"
  }
  if (id.includes("node_modules/next-themes/") || id.includes("node_modules/sonner/")) {
    return "vendor-app"
  }
  if (
    id.includes("node_modules/@radix-ui/")
    || id.includes("node_modules/cmdk/")
    || id.includes("node_modules/vaul/")
    || id.includes("node_modules/react-resizable-panels/")
  ) {
    return "vendor-ui"
  }
  if (id.includes("node_modules/recharts/")) {
    return "vendor-charts"
  }
  if (id.includes("node_modules/lucide-react/")) {
    return "vendor-icons"
  }
  if (id.includes("node_modules/zod/")) {
    return "vendor-validation"
  }
  return "vendor-misc"
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "")
  const devServerPort = Number(env.VITE_DEV_SERVER_PORT || env.PORT || 8022)
  const bffProxyTarget = env.VITE_BFF_PROXY_TARGET || "http://localhost:8030"

  return {
    base: "./",
    plugins: [react(), buildVersionManifestPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __BUILD_LABEL__: JSON.stringify(buildLabel),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: devServerPort,
      strictPort: true,
      hmr: {
        protocol: "ws",
        host: "localhost",
        port: devServerPort,
        clientPort: devServerPort,
      },
      proxy: {
        // BFF prompt proxy. Keeps system prompts out of the frontend bundle.
        "/api/prompt": {
          target: bffProxyTarget,
          rewrite: (p) => p.replace(/^\/api\/prompt/, "/api"),
          changeOrigin: true,
          timeout: 900_000,
          proxyTimeout: 900_000,
        },
        "/api/chat/completions": {
          target: bffProxyTarget,
          changeOrigin: true,
          timeout: 900_000,
          proxyTimeout: 900_000,
        },
        "/api/jobs": {
          target: bffProxyTarget,
          changeOrigin: true,
          timeout: 900_000,
          proxyTimeout: 900_000,
        },
        "/api/seedance-cloud": {
          target: env.VITE_SEEDANCE_CLOUD_PROXY_TARGET || "http://127.0.0.1:8034",
          rewrite: (p) => p.replace(/^\/api\/seedance-cloud/, "/api"),
          changeOrigin: true,
        },
        "/api/seedance-krea": {
          target: env.VITE_SEEDANCE_KREA_PROXY_TARGET || "http://127.0.0.1:8036",
          rewrite: (p) => p.replace(/^\/api\/seedance-krea/, "/api"),
          changeOrigin: true,
        },
        // Seedance API proxy for local development.
        "/api/seedance": {
          target: "http://localhost:8033",
          rewrite: (p) => p.replace(/^\/api\/seedance/, "/api"),
          changeOrigin: true,
        },
        "/api/hm": {
          target: "https://api.huameng.space",
          rewrite: (p) => p.replace(/^\/api\/hm/, ""),
          changeOrigin: true,
          secure: true,
        },
        // Volcengine API proxy for local development.
        "/api/volc": {
          target: "https://ark.cn-beijing.volces.com/api/v3",
          rewrite: (p) => p.replace(/^\/api\/volc/, ""),
          changeOrigin: true,
          secure: true,
        },
        // Aliyun Bailian DashScope API proxy for local development.
        "/api/aliyun": {
          target: "https://dashscope.aliyuncs.com/api/v1",
          rewrite: (p) => p.replace(/^\/api\/aliyun/, ""),
          changeOrigin: true,
          secure: true,
        },
        "/api/proxy/image": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
        // Video proxy for CDN CORS handling.
        "/api/proxy/video": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
        "/api/media": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
        "/api/render": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
        "/api/auth": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
        "/api/admin": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
        "/api/cloud": {
          target: bffProxyTarget,
          changeOrigin: true,
          timeout: 900_000,
          proxyTimeout: 900_000,
        },
        "/api/xyq-agent": {
          target: bffProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
