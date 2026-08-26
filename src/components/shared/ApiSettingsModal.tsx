// ============================================================
// API 设置弹窗组件 - 对话模型 / 图片模型 / 视频模型 分区配置
// ============================================================

import { useState, type Dispatch } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useProject } from '@/stores/projectStore';
import { Bot, DownloadCloud, ExternalLink, Flame, Satellite, Sparkles } from 'lucide-react';
import type { Action } from '@/stores/projectStore';
import { testApiConnection } from '@/lib/api-client';
import { testTtsConnection } from '@/lib/mimoTtsClient';
import { normalizeImageApiConfig, normalizeVideoApiConfig } from '@/lib/storage';
import { DEFAULT_VOLC_API_BASE } from '@/lib/volcengineApiClient';
import {
  getVolcVideoDurationOptions,
  getVolcVideoModelCapabilities,
  normalizeVolcVideoDuration,
  VOLC_VIDEO_MODEL_OPTIONS,
} from '@/lib/volcengineVideoModels';
import { getStoryboardVoiceReferenceLimit } from '@/lib/characterVoiceReferences';
import {
  buildSeedanceFetchInit,
  DEFAULT_SEEDANCE_CLOUD_API_BASE,
  SEEDANCE_SERVICE_DURATIONS,
  SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS,
  getSeedanceResolutionOptions,
  getSeedanceCloudLicenseKey,
  isSeedanceServiceBackend,
  normalizeSeedanceCloudBaseUrl,
  normalizeSeedanceServiceDuration,
  normalizeSeedanceServiceResolution,
  normalizeVisibleSeedanceServiceModel,
} from '@/lib/seedanceApi';
import type {
  AppState,
  VideoBackendType,
  ImageSize,
  ApimartImageBackground,
  ApimartImageModeration,
  ApimartImageOutputFormat,
  ApimartImageQuality,
} from '@/types';

interface ApiSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const APIMART_IMAGE_BASE_URL = 'https://api.apimart.ai/v1';
const DEFAULT_SEEDANCE_CLOUD_BASE_URL = '/api/seedance-cloud';
const HAPPYHORSE_MODEL = 'happyhorse-1.0-r2v';
const VIDEO_RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4k'] as const;

function formatVideoResolutionLabel(value: string) {
  return value === '4k' ? '4K' : value;
}

function maskLicenseKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const visibleLength = trimmed.length <= 8 ? Math.min(3, trimmed.length) : 6;
  return `${trimmed.slice(0, visibleLength)}***`;
}

function isApimartImageConfig(baseUrl: string) {
  return /apimart\.ai/i.test(baseUrl);
}

function isXiakemanArtlistImageConfig(baseUrl: string) {
  return /sd2\.xiakeman\.com/i.test(baseUrl);
}

function isApimartGptImage2OfficialModel(model: string) {
  return /^gpt-image-2-official$/i.test(model.trim());
}

function isApimartGemini31FlashImageModel(model: string) {
  return /^gemini-3\.1-flash-image-preview$/i.test(model.trim());
}

export function ApiSettingsModal({ open, onOpenChange }: ApiSettingsModalProps) {
  const { state, dispatch } = useProject();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ApiSettingsContent
          state={state}
          dispatch={dispatch}
          onOpenChange={onOpenChange}
        />
      )}
    </Dialog>
  );
}

function ApiSettingsContent({
  state,
  dispatch,
  onOpenChange,
}: {
  state: AppState;
  dispatch: Dispatch<Action>;
  onOpenChange: (open: boolean) => void;
}) {
  const [localConfig, setLocalConfig] = useState(state.apiConfig);
  const [localImageConfig, setLocalImageConfig] = useState(() => normalizeImageApiConfig(state.imageApiConfig));
  const [localVideoConfig, setLocalVideoConfig] = useState(() => normalizeVideoApiConfig(state.videoApiConfig));
  const [localTtsConfig, setLocalTtsConfig] = useState(state.ttsApiConfig);
  const [localMusicConfig, setLocalMusicConfig] = useState(state.musicApiConfig);
  const localGlobalTaskSettings = state.globalTaskSettings;
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [ttsTesting, setTtsTesting] = useState(false);
  const [ttsTestResult, setTtsTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState('llm');
  const selectedVideoBackend = localVideoConfig.backend;
  const isSeedanceBackend = selectedVideoBackend === 'seedance';
  const isSeedanceCloudBackend = selectedVideoBackend === 'seedancecloud';
  const isXyqAgentBackend = selectedVideoBackend === 'xyqagent';
  const isVolcBackend = selectedVideoBackend === 'volcengine';
  const isAliyunBackend = selectedVideoBackend === 'aliyunbailian';
  const isSeedanceServiceSelected = isSeedanceServiceBackend(selectedVideoBackend);
  const normalizedSeedanceModel = normalizeVisibleSeedanceServiceModel(localVideoConfig.seedanceModel);
  const selectedSeedanceModel = SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS.find((option) => option.value === normalizedSeedanceModel)
    ?? SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS[0];
  const selectedSeedanceResolutions = getSeedanceResolutionOptions(normalizedSeedanceModel);
  const visibleVideoResolutions = isSeedanceCloudBackend ? selectedSeedanceResolutions : VIDEO_RESOLUTION_OPTIONS;
  const volcCapabilities = getVolcVideoModelCapabilities(localVideoConfig.volcModel);
  const voiceReferenceLimit = getStoryboardVoiceReferenceLimit(localVideoConfig);
  const effectiveVideoDuration = isVolcBackend
    ? normalizeVolcVideoDuration(localVideoConfig.videoDuration, 10, localVideoConfig.volcModel)
    : normalizeSeedanceServiceDuration(localVideoConfig.videoDuration);
  const videoDurationOptions = isVolcBackend
    ? getVolcVideoDurationOptions(localVideoConfig.volcModel)
    : [...SEEDANCE_SERVICE_DURATIONS];
  const isApimartImage = isApimartImageConfig(localImageConfig.baseUrl);
  const isXiakemanArtlistImage = isXiakemanArtlistImageConfig(localImageConfig.baseUrl);
  const isApimartOfficialImage = isApimartGptImage2OfficialModel(localImageConfig.model);
  const isApimartGeminiImage = isApimartGemini31FlashImageModel(localImageConfig.model);
  const [seedanceCloudCookieLoading, setSeedanceCloudCookieLoading] = useState(false);
  const [seedanceCloudCookieMessage, setSeedanceCloudCookieMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [seedanceCloudKeyFocused, setSeedanceCloudKeyFocused] = useState(false);

  const buildSeedanceCloudConfig = () => normalizeVideoApiConfig({
    ...localVideoConfig,
    backend: 'seedancecloud',
    seedanceCloudBaseUrl: normalizeSeedanceCloudBaseUrl(localVideoConfig.seedanceCloudBaseUrl),
  });

  const readSeedanceCloudError = async (response: Response) => {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    try {
      const data = JSON.parse(text) as { error?: { message?: string; detail?: string }; message?: string };
      return data.error?.message || data.error?.detail || data.message || text;
    } catch {
      return text;
    }
  };

  const runSeedanceCloudAction = async (
    action: () => Promise<void>,
    fallbackMessage: string,
  ) => {
    setSeedanceCloudCookieLoading(true);
    setSeedanceCloudCookieMessage(null);
    try {
      const config = buildSeedanceCloudConfig();
      if (!getSeedanceCloudLicenseKey(config)) {
        throw new Error('请先填写云端许可证。');
      }
      await action();
    } catch (error) {
      setSeedanceCloudCookieMessage({
        success: false,
        message: error instanceof Error ? error.message : fallbackMessage,
      });
    } finally {
      setSeedanceCloudCookieLoading(false);
    }
  };

  const handleSeedanceCloudStatsTest = async () => {
    await runSeedanceCloudAction(async () => {
      const config = buildSeedanceCloudConfig();
      const base = normalizeSeedanceCloudBaseUrl(config.seedanceCloudBaseUrl);
      const response = await fetch(`${base}/balance`, buildSeedanceFetchInit(config));
      if (!response.ok) throw new Error(await readSeedanceCloudError(response));
      const data = await response.json() as {
        wallet?: {
          available_balance?: number;
          balance?: number;
          frozen_balance?: number;
        };
      };
      const available = data.wallet?.available_balance ?? data.wallet?.balance ?? '未知';
      const frozen = data.wallet?.frozen_balance ?? 0;
      setSeedanceCloudCookieMessage({
        success: true,
        message: `卡密可用，可用积分 ${available}，冻结积分 ${frozen}。`,
      });
    }, '云端许可证测试失败');
  };

  const handleSave = () => {
    const nextImageConfig = normalizeImageApiConfig(localImageConfig);
    const nextVideoConfig = normalizeVideoApiConfig(localVideoConfig);
    dispatch({ type: 'SET_API_CONFIG', config: localConfig });
    dispatch({ type: 'SET_IMAGE_API_CONFIG', config: nextImageConfig });
    dispatch({ type: 'SET_VIDEO_API_CONFIG', config: nextVideoConfig });
    dispatch({ type: 'SET_TTS_API_CONFIG', config: localTtsConfig });
    dispatch({ type: 'SET_MUSIC_API_CONFIG', config: localMusicConfig });
    dispatch({ type: 'SET_GLOBAL_TASK_SETTINGS', settings: localGlobalTaskSettings });
    // Store 的 persist 会自动写入 localStorage（含 drama-api-config），无需手动写入
    toast.success('API 设置已保存到当前浏览器');
    onOpenChange(false);
  };

  const handleLlmTest = async () => {
    setLlmTesting(true);
    setLlmTestResult(null);
    try {
      const result = await testApiConnection(localConfig);
      setLlmTestResult(result);
    } catch {
      setLlmTestResult({
        success: false,
        message: '连接测试失败',
      });
    }
    setLlmTesting(false);
  };

  const handleTtsTest = async () => {
    setTtsTesting(true);
    setTtsTestResult(null);
    try {
      const result = await testTtsConnection(localTtsConfig);
      setTtsTestResult(result);
    } catch {
      setTtsTestResult({
        success: false,
        message: '语音连接测试失败',
      });
    }
    setTtsTesting(false);
  };

  const dialogMaxWidth = activeTab === 'video'
    ? 1220
    : activeTab === 'image'
      ? 820
      : 720;

  return (
    <DialogContent
      className="flex max-h-[92vh] flex-col overflow-hidden p-0"
      style={{ maxWidth: `min(calc(100vw - 2rem), ${dialogMaxWidth}px)` }}
    >
        <DialogHeader className="shrink-0 border-b border-border/60 bg-background/95 px-5 pb-3 pt-5">
          <DialogTitle>API 配置</DialogTitle>
          <DialogDescription>
            分别配置对话模型、图片模型、视频模型的 API，密钥仅存储在浏览器本地
          </DialogDescription>
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
            社区版不提供账号登录。这里填写的地址、模型和 Key 只保存在当前浏览器，请勿在共享电脑上保存私人密钥。
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 grid h-auto grid-cols-2 gap-1 rounded-xl bg-muted/45 p-1 sm:grid-cols-5">
            <TabsTrigger value="llm">💬 对话模型</TabsTrigger>
            <TabsTrigger value="image">🖼️ 图片模型</TabsTrigger>
            <TabsTrigger value="video">🎬 视频模型</TabsTrigger>
            <TabsTrigger value="tts">🎤 语音模型</TabsTrigger>
            <TabsTrigger value="music" disabled>🎵 音乐模型</TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-3 pt-2">

          {/* === 对话模型（LLM）=== */}
          <TabsContent value="llm" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="baseUrl">API 地址</Label>
              <Input
                id="baseUrl"
                placeholder="https://api.openai.com/v1"
                value={localConfig.baseUrl}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                填写你自己的 OpenAI 兼容 <code>/v1</code> 接口地址。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="sk-..."
                value={localConfig.apiKey}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">对话模型</Label>
              <Input
                id="model"
                placeholder="填写服务商提供的模型名"
                value={localConfig.model}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, model: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                模型名必须与服务商控制台一致；社区版不会自动替你选择或购买模型。
              </p>
            </div>

            {/* 测试结果 */}
            <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Label htmlFor="step4BrowserDirectLlm">文本 LLM 已固定前台直连</Label>
                  <p className="text-xs text-muted-foreground">
                    Step1 分析和 Step4 故事板文本会实时回流，不再切到后台托管队列。
                  </p>
                </div>
                <Switch
                  id="step4BrowserDirectLlm"
                  checked
                  disabled
                />
              </div>
            </div>

            {llmTestResult && (
              <div
                className={`rounded-md p-3 text-sm ${
                  llmTestResult.success
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {llmTestResult.message}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleLlmTest}
              disabled={llmTesting || !localConfig.apiKey || !localConfig.baseUrl}
            >
              {llmTesting ? '测试中...' : '测试连接'}
            </Button>
          </TabsContent>

          {/* === 图片生成 API === */}
          <TabsContent value="image" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="imgBaseUrl">API 地址</Label>
              <Input
                id="imgBaseUrl"
                placeholder="https://api.example.com/v1"
                value={localImageConfig.baseUrl}
                onChange={(e) =>
                  setLocalImageConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                支持自定义 OpenAI 兼容图片接口，也可使用下面的第三方格式预设后再填写自己的 Key。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="imgApiKey">API Key</Label>
              <Input
                id="imgApiKey"
                type="password"
                placeholder={isXiakemanArtlistImage ? 'X-License-Key（可复用云端许可证）' : 'sk-...'}
                value={localImageConfig.apiKey}
                onChange={(e) =>
                  setLocalImageConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {isXiakemanArtlistImage
                  ? '兼容图片通道使用 X-License-Key；图片和视频为同一服务时可复用下方云端许可证。'
                  : '密钥仅存储在浏览器本地，不会上传到任何服务器'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="imgModel">图片模型</Label>
              <Input
                id="imgModel"
                placeholder="nano-banana / nano-banana-pro / seedream-5.0 / gpt-image-2"
                value={localImageConfig.model}
                onChange={(e) =>
                  setLocalImageConfig((prev) => ({ ...prev, model: e.target.value }))
                }
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setLocalImageConfig((prev) => ({
                    ...prev,
                    baseUrl: APIMART_IMAGE_BASE_URL,
                    model: 'gpt-image-2',
                    defaultImageSize: prev.defaultImageSize ?? '1K',
                  }))}
                >
                  APIMart GPT-Image-2
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setLocalImageConfig((prev) => ({
                    ...prev,
                    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
                    model: 'doubao-seedream-5-0-260128',
                    defaultImageSize: prev.defaultImageSize ?? '1K',
                  }))}
                >
                  Seedream 5.0 lite
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                其他服务商或模型可直接手动填写完整接口地址和模型名。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="imgDefaultSize">默认图片尺寸</Label>
              <div className="flex gap-1.5">
                {(['1K', '2K', '4K'] as ImageSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() =>
                      setLocalImageConfig((prev) => ({ ...prev, defaultImageSize: size }))
                    }
                    className={`flex-1 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                      (localImageConfig.defaultImageSize ?? '1K') === size
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-muted hover:border-muted-foreground/50 text-muted-foreground'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                图片生成的默认分辨率。兼容图片服务会按模型自动映射可用尺寸；Seedream 5.0 lite 会把 1K 按 2K 请求，4K 按 3K 请求。
              </p>
            </div>
            {isApimartImage && (
              <div className="space-y-3 rounded-md border border-muted bg-muted/20 p-3">
                <p className="text-sm font-medium">APIMart 高级参数</p>

                {isApimartGeminiImage && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="apimartGoogleSearch"
                        type="checkbox"
                        checked={localImageConfig.apimartGoogleSearch ?? false}
                        onChange={(e) =>
                          setLocalImageConfig((prev) => ({ ...prev, apimartGoogleSearch: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor="apimartGoogleSearch" className="text-sm font-normal">
                        Google 搜索
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="apimartGoogleImageSearch"
                        type="checkbox"
                        checked={localImageConfig.apimartGoogleImageSearch ?? false}
                        onChange={(e) =>
                          setLocalImageConfig((prev) => ({ ...prev, apimartGoogleImageSearch: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor="apimartGoogleImageSearch" className="text-sm font-normal">
                        Google 图片搜索
                      </Label>
                    </div>
                  </div>
                )}

                {isApimartOfficialImage && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="apimartQuality">质量</Label>
                        <Select
                          value={localImageConfig.apimartQuality ?? 'auto'}
                          onValueChange={(val: ApimartImageQuality) =>
                            setLocalImageConfig((prev) => ({ ...prev, apimartQuality: val }))
                          }
                        >
                          <SelectTrigger id="apimartQuality" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">auto</SelectItem>
                            <SelectItem value="high">high</SelectItem>
                            <SelectItem value="medium">medium</SelectItem>
                            <SelectItem value="low">low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="apimartBackground">背景</Label>
                        <Select
                          value={localImageConfig.apimartBackground ?? 'auto'}
                          onValueChange={(val: ApimartImageBackground) =>
                            setLocalImageConfig((prev) => ({ ...prev, apimartBackground: val }))
                          }
                        >
                          <SelectTrigger id="apimartBackground" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">auto</SelectItem>
                            <SelectItem value="transparent">transparent</SelectItem>
                            <SelectItem value="opaque">opaque</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="apimartModeration">审核</Label>
                        <Select
                          value={localImageConfig.apimartModeration ?? 'auto'}
                          onValueChange={(val: ApimartImageModeration) =>
                            setLocalImageConfig((prev) => ({ ...prev, apimartModeration: val }))
                          }
                        >
                          <SelectTrigger id="apimartModeration" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">auto</SelectItem>
                            <SelectItem value="low">low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="apimartOutputFormat">输出格式</Label>
                        <Select
                          value={localImageConfig.apimartOutputFormat ?? 'png'}
                          onValueChange={(val: ApimartImageOutputFormat) =>
                            setLocalImageConfig((prev) => ({ ...prev, apimartOutputFormat: val }))
                          }
                        >
                          <SelectTrigger id="apimartOutputFormat" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="png">png</SelectItem>
                            <SelectItem value="jpeg">jpeg</SelectItem>
                            <SelectItem value="webp">webp</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="apimartOutputCompression">压缩率</Label>
                        <Input
                          id="apimartOutputCompression"
                          type="number"
                          min={0}
                          max={100}
                          value={localImageConfig.apimartOutputCompression ?? 100}
                          onChange={(e) => {
                            const nextValue = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                            setLocalImageConfig((prev) => ({ ...prev, apimartOutputCompression: nextValue }));
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="apimartMaskUrl">遮罩 URL</Label>
                        <Input
                          id="apimartMaskUrl"
                          placeholder="https://..."
                          value={localImageConfig.apimartMaskUrl ?? ''}
                          onChange={(e) =>
                            setLocalImageConfig((prev) => ({ ...prev, apimartMaskUrl: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* === 视频生成 API === */}
          <TabsContent value="video" className="pt-2">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="space-y-3">
                <section className="rounded-xl border border-muted bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">通用视频参数</p>
                      <p className="text-xs text-muted-foreground">
                        时长、画幅和分辨率决定整条视频的基础提交模板。
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/10">
                      {effectiveVideoDuration}s · {localVideoConfig.videoRatio || '16:9'} · {formatVideoResolutionLabel(localVideoConfig.videoResolution || '720p')}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="videoDuration">视频时长（秒）</Label>
                      <div id="videoDuration" className="grid grid-cols-4 gap-1.5">
                        {videoDurationOptions.map((duration) => (
                          <button
                            key={duration}
                            type="button"
                            onClick={() => setLocalVideoConfig((prev) => ({ ...prev, videoDuration: duration }))}
                            className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                              effectiveVideoDuration === duration
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-muted text-muted-foreground hover:border-muted-foreground/50'
                            }`}
                          >
                            {duration} 秒
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {isVolcBackend && volcCapabilities.isSeedance25
                          ? 'Seedance 2.5 支持 4~30 秒整数；Step5 提交时会优先使用当前分镜在 Step4 中写明的时长。'
                          : '当前模型支持 4~15 秒整数；Step5 提交时会优先使用当前分镜在 Step4 中写明的时长。'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="videoRatio">全局成片画幅</Label>
                      <select
                        id="videoRatio"
                        value={localVideoConfig.videoRatio || '16:9'}
                        onChange={(e) =>
                          setLocalVideoConfig((prev) => ({ ...prev, videoRatio: e.target.value }))
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="9:16">9:16（竖屏）</option>
                        <option value="16:9">16:9（横屏）</option>
                      </select>
                      <p className="text-[10px] text-muted-foreground">
                        同步影响 Step4 场景定位图、参考图选择和 Step5 视频模型比例。
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1">
                    <Label htmlFor="videoResolution">分辨率</Label>
                    <div className="flex gap-1.5">
                      {visibleVideoResolutions.map((res) => {
                        const isDisabled = (isVolcBackend && res === '1080p' && localVideoConfig.volcModel?.includes('fast'))
                          || (isVolcBackend && res === '4k')
                          || (res === '480p' && isAliyunBackend)
                          || (res === '4k' && isAliyunBackend);
                        return (
                          <button
                            key={res}
                            type="button"
                            disabled={isDisabled}
                            onClick={() => setLocalVideoConfig((prev) => ({ ...prev, videoResolution: res }))}
                            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                              isDisabled
                                ? 'cursor-not-allowed border-muted opacity-40'
                                : (localVideoConfig.videoResolution ?? '720p') === res
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-muted text-muted-foreground hover:border-muted-foreground/50'
                            }`}
                            title={isDisabled
                              ? (isAliyunBackend && (res === '480p' || res === '4k')
                                ? 'HappyHorse 支持 720P 和 1080P'
                                : isSeedanceCloudBackend
                                  ? `${selectedSeedanceModel.label} 支持 ${selectedSeedanceResolutions.map(formatVideoResolutionLabel).join(' / ')}`
                                  : '当前模型暂不支持该分辨率')
                              : ''}
                          >
                            {formatVideoResolutionLabel(res)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Mini/Fast 支持 480p 和 720p；Seedance2.0 满血支持 480p、720p、1080p 和 4K；HappyHorse 支持 720P 和 1080P。
                    </p>
                  </div>
                </section>

                <section className="space-y-3 rounded-xl border border-muted bg-muted/15 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">视频生成后端</p>
                      <p className="text-xs text-muted-foreground">选择你要走的提交通道。</p>
                    </div>
                    <a
                      href="https://github.com/XiakeMan777/seedance2.0_XYQ_APi"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      本地程序
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => setLocalVideoConfig((prev) => ({
                        ...prev,
                        backend: 'seedance' as VideoBackendType,
                        videoResolution: prev.videoResolution === '4k' ? '1080p' : prev.videoResolution,
                      }))}
                      className={`flex min-h-[68px] items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedVideoBackend === 'seedance'
                          ? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]'
                          : 'border-muted bg-background/40 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/40'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        selectedVideoBackend === 'seedance' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5 text-foreground">小云雀本地</span>
                        <span className="block text-xs leading-4">本地服务</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalVideoConfig((prev) => ({
                        ...prev,
                        backend: 'seedancecloud' as VideoBackendType,
                        seedanceCloudBaseUrl: prev.seedanceCloudBaseUrl || DEFAULT_SEEDANCE_CLOUD_BASE_URL,
                        seedanceModel: normalizeVisibleSeedanceServiceModel(prev.seedanceModel),
                        videoResolution: normalizeSeedanceServiceResolution(normalizeVisibleSeedanceServiceModel(prev.seedanceModel), prev.videoResolution),
                        videoDuration: normalizeSeedanceServiceDuration(prev.videoDuration),
                      }))}
                      className={`flex min-h-[68px] items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedVideoBackend === 'seedancecloud'
                          ? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]'
                          : 'border-muted bg-background/40 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/40'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        selectedVideoBackend === 'seedancecloud' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        <DownloadCloud className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5 text-foreground">Seedance 兼容云端</span>
                        <span className="block text-xs leading-4">X-License-Key</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalVideoConfig((prev) => ({
                        ...prev,
                        backend: 'xyqagent' as VideoBackendType,
                        videoResolution: prev.videoResolution === '4k' ? '1080p' : prev.videoResolution,
                      }))}
                      className={`flex min-h-[68px] items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedVideoBackend === 'xyqagent'
                          ? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]'
                          : 'border-muted bg-background/40 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/40'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        selectedVideoBackend === 'xyqagent' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        <Satellite className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5 text-foreground">小云雀 Agent</span>
                        <span className="block text-xs leading-4">Access Key</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalVideoConfig((prev) => ({
                        ...prev,
                        backend: 'volcengine' as VideoBackendType,
                        videoResolution: prev.videoResolution === '4k' ? '1080p' : prev.videoResolution,
                      }))}
                      className={`flex min-h-[68px] items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedVideoBackend === 'volcengine'
                          ? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]'
                          : 'border-muted bg-background/40 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/40'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        selectedVideoBackend === 'volcengine' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        <Flame className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5 text-foreground">火山方舟</span>
                        <span className="block text-xs leading-4">Seedance 官方</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalVideoConfig((prev) => ({
                        ...prev,
                        backend: 'aliyunbailian' as VideoBackendType,
                        aliyunModel: prev.aliyunModel || HAPPYHORSE_MODEL,
                        aliyunRegion: prev.aliyunRegion || 'cn-beijing',
                        videoResolution: prev.videoResolution === '480p'
                          ? '720p'
                          : prev.videoResolution === '4k'
                            ? '1080p'
                            : prev.videoResolution,
                      }))}
                      className={`flex min-h-[68px] items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedVideoBackend === 'aliyunbailian'
                          ? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]'
                          : 'border-muted bg-background/40 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/40'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        selectedVideoBackend === 'aliyunbailian' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        <Sparkles className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5 text-foreground">百炼 HappyHorse</span>
                        <span className="block text-xs leading-4">参考生视频</span>
                      </span>
                    </button>
                  </div>
                </section>

                <section className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-3 text-sm text-cyan-900 dark:border-cyan-400/20 dark:bg-cyan-500/10 dark:text-cyan-50">
                  <div className="flex items-start gap-3">
                    <input
                      id="characterVoiceReferencesEnabled"
                      type="checkbox"
                      checked={localVideoConfig.characterVoiceReferencesEnabled === true}
                      onChange={(e) =>
                        setLocalVideoConfig((prev) => ({ ...prev, characterVoiceReferencesEnabled: e.target.checked }))
                      }
                      className="mt-0.5 h-4 w-4 rounded border-cyan-300"
                    />
                    <div className="space-y-1">
                      <Label htmlFor="characterVoiceReferencesEnabled" className="text-sm font-medium">
                        启用角色配音参考
                      </Label>
                      <p className="text-xs leading-4 text-cyan-800 dark:text-cyan-100/80">
                        开启后 Step4 会把最多 {voiceReferenceLimit} 位实际开口角色写入 Seedance 提交词；Step5 会按当前后端和模型上限提交音频参考。关闭后不改提示词，也不提交声线媒体。
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="space-y-3">
                {isSeedanceServiceSelected && (
                  <section className="rounded-xl border border-muted bg-muted/15 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Seedance 调度</p>
                        <p className="text-xs text-muted-foreground">提交节奏与轮询超时由本地和兼容云端 Seedance 共用。</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-white/70 bg-white/70 px-2 py-0.5 text-[10px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                        {Math.floor((localVideoConfig.seedanceTimeout || 7200) / 60)}m · {localVideoConfig.seedanceBatchDelay === 0 ? '无延时' : `${localVideoConfig.seedanceBatchDelay || 100}s`}
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="seedanceTimeout" className="text-xs">任务超时</Label>
                          <span className="text-[10px] text-muted-foreground">{Math.floor(localVideoConfig.seedanceTimeout / 60)} 分钟</span>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id="seedanceTimeout"
                            type="number"
                            min={60}
                            max={7200}
                            step={60}
                            value={localVideoConfig.seedanceTimeout}
                            onChange={(e) => {
                              const val = Math.max(60, Math.min(7200, parseInt(e.target.value) || 7200));
                              setLocalVideoConfig((prev) => ({ ...prev, seedanceTimeout: val }));
                            }}
                            className="h-8 text-xs"
                          />
                          <div className="grid w-[112px] grid-cols-2 gap-1">
                            {[1200, 1800, 3600, 7200].map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setLocalVideoConfig((prev) => ({ ...prev, seedanceTimeout: t }))}
                                className={`rounded border px-1.5 py-1 text-[10px] transition-colors ${
                                  localVideoConfig.seedanceTimeout === t
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-muted text-muted-foreground hover:border-muted-foreground/50'
                                }`}
                              >
                                {t / 60}m
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="seedanceBatchDelay" className="text-xs">批量延时</Label>
                          <span className="text-[10px] text-muted-foreground">
                            {localVideoConfig.seedanceBatchDelay === 0 ? '无延时' : `${localVideoConfig.seedanceBatchDelay}s / 个`}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id="seedanceBatchDelay"
                            type="number"
                            min={0}
                            max={300}
                            step={5}
                            value={localVideoConfig.seedanceBatchDelay}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(300, parseInt(e.target.value) || 100));
                              setLocalVideoConfig((prev) => ({ ...prev, seedanceBatchDelay: val }));
                            }}
                            className="h-8 text-xs"
                          />
                          <div className="grid w-[112px] grid-cols-2 gap-1">
                            {[0, 30, 100, 120].map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setLocalVideoConfig((prev) => ({ ...prev, seedanceBatchDelay: t }))}
                                className={`rounded border px-1.5 py-1 text-[10px] transition-colors ${
                                  localVideoConfig.seedanceBatchDelay === t
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-muted text-muted-foreground hover:border-muted-foreground/50'
                                }`}
                              >
                                {t === 0 ? '0s' : `${t}s`}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {isSeedanceBackend && (
                  <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-100">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">小云雀本地</p>
                        <p className="text-xs text-blue-700 dark:text-blue-100/80">
                          本地 Playwright 自动化调用小云雀平台（xyq.jianying.com）生成视频。
                        </p>
                      </div>
                      <span className="rounded-full border border-blue-200 bg-white/60 px-2 py-1 text-[10px] text-blue-700 dark:border-blue-400/30 dark:bg-white/10 dark:text-blue-100">
                        :8033
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-blue-700 dark:text-blue-100/80">
                      需要本地运行 Flask 后端并配置 Cookie，模型固定为 Seedance 2.0 Fast。
                    </p>
                    <a
                      href="https://github.com/XiakeMan777/seedance2.0_XYQ_APi"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex text-xs font-medium text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-200 dark:hover:text-blue-100"
                    >
                      程序网址：https://github.com/XiakeMan777/seedance2.0_XYQ_APi
                    </a>
                  </section>
                )}

                {isSeedanceCloudBackend && (
                  <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-slate-950/70 dark:text-sky-50">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium mb-1">Seedance 兼容云端</p>
                        <p className="text-xs text-sky-700 dark:text-sky-200/85">
                          填写你自建或已获授权的兼容服务地址与许可证。
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="seedanceCloudBaseUrl">云端接口地址</Label>
                          <Input
                            id="seedanceCloudBaseUrl"
                            placeholder={DEFAULT_SEEDANCE_CLOUD_BASE_URL}
                            value={localVideoConfig.seedanceCloudBaseUrl || DEFAULT_SEEDANCE_CLOUD_BASE_URL}
                            onChange={(e) =>
                              setLocalVideoConfig((prev) => ({ ...prev, seedanceCloudBaseUrl: e.target.value }))
                            }
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setLocalVideoConfig((prev) => ({
                                ...prev,
                                seedanceCloudBaseUrl: DEFAULT_SEEDANCE_CLOUD_BASE_URL,
                              }))}
                            >
                              填入云端地址
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setLocalVideoConfig((prev) => ({
                                ...prev,
                                seedanceCloudBaseUrl: DEFAULT_SEEDANCE_CLOUD_API_BASE,
                              }))}
                            >
                              恢复默认地址
                            </Button>
                          </div>
                          <p className="text-xs text-sky-700/80 dark:text-slate-300">
                            这里填云端主机地址即可，系统会自动补成 <code>/api</code> 路径。
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="seedanceModel">视频模型</Label>
                          <Select
                            value={selectedSeedanceModel.value}
                            onValueChange={(val) =>
                              setLocalVideoConfig((prev) => ({
                                ...prev,
                                seedanceModel: val,
                                videoResolution: normalizeSeedanceServiceResolution(val, prev.videoResolution),
                              }))
                            }
                          >
                            <SelectTrigger id="seedanceModel" className="w-full min-w-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-sky-700/80 dark:text-slate-300">
                            {selectedSeedanceModel.detail}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3 border-t border-sky-200/80 pt-4 dark:border-sky-500/25 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                        <div className="space-y-2">
                          <Label htmlFor="seedanceCloudLicenseKey">云端许可证</Label>
                          <Input
                            id="seedanceCloudLicenseKey"
                            placeholder="输入服务商分配的许可证"
                            value={seedanceCloudKeyFocused
                              ? localVideoConfig.seedanceCloudLicenseKey
                              : maskLicenseKey(localVideoConfig.seedanceCloudLicenseKey)}
                            onFocus={() => setSeedanceCloudKeyFocused(true)}
                            onBlur={() => setSeedanceCloudKeyFocused(false)}
                            onChange={(e) =>
                              setLocalVideoConfig((prev) => ({ ...prev, seedanceCloudLicenseKey: e.target.value }))
                            }
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <p className="text-xs text-sky-700/80 dark:text-slate-300">
                            请求通过 <code>X-License-Key</code> 发送；社区版不附带许可证。
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full justify-center"
                          onClick={handleSeedanceCloudStatsTest}
                          disabled={seedanceCloudCookieLoading}
                        >
                          {seedanceCloudCookieLoading ? '查询中...' : '测试许可证 / 查询余额'}
                        </Button>
                      </div>
                    </div>

                    {seedanceCloudCookieMessage && (
                      <div className={`rounded-md border px-3 py-2 text-xs ${
                        seedanceCloudCookieMessage.success
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100'
                          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-100'
                      }`}
                      >
                        {seedanceCloudCookieMessage.message}
                      </div>
                    )}
                  </section>
                )}

                {isXyqAgentBackend && (
                  <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-100">
                    <div>
                      <p className="font-medium mb-1">小云雀 Agent · Seedance 2.0 Fast</p>
                      <div className="space-y-1 text-xs leading-relaxed text-violet-700 dark:text-violet-100/80">
                        <span className="block">去小云雀首页右上角点“连接 Agent”，拿到密钥后把 Access Key 填进来。</span>
                        <span className="block">官方没有模型选择，这里会自动走 Seedance 2.0 Fast VIP 模型，消耗积分比普通 Fast 更高。</span>
                        <a
                          href="https://bytedance.larkoffice.com/wiki/JUlowWl8Bi6X8fkTKrYc70zRnVc"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex font-medium text-violet-700 underline underline-offset-2 hover:text-violet-600 dark:text-violet-200 dark:hover:text-violet-100"
                        >
                          详细文档介绍
                        </a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="xyqAgentAccessKey">Access Key</Label>
                      <Input
                        id="xyqAgentAccessKey"
                        type="password"
                        placeholder="小云雀 Agent Access Key"
                        value={localVideoConfig.xyqAgentAccessKey}
                        onChange={(e) =>
                          setLocalVideoConfig((prev) => ({ ...prev, xyqAgentAccessKey: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="xyqAgentBaseUrl">Agent Base URL</Label>
                      <Input
                        id="xyqAgentBaseUrl"
                        placeholder="https://xyq.jianying.com"
                        value={localVideoConfig.xyqAgentBaseUrl}
                        onChange={(e) =>
                          setLocalVideoConfig((prev) => ({ ...prev, xyqAgentBaseUrl: e.target.value }))
                        }
                      />
                      <p className="text-xs text-violet-700/80 dark:text-violet-100/80">默认即可；如有私有部署或代理再改这里。</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="xyqAgentTimeout">⏱️ 任务超时时间（秒）</Label>
                      <div className="flex items-center gap-3">
                        <Input
                          id="xyqAgentTimeout"
                          type="number"
                          min={60}
                          max={7200}
                          step={60}
                          value={localVideoConfig.xyqAgentTimeout}
                          onChange={(e) => {
                            const val = Math.max(60, Math.min(7200, parseInt(e.target.value) || 1800));
                            setLocalVideoConfig((prev) => ({ ...prev, xyqAgentTimeout: val }));
                          }}
                          className="w-32"
                        />
                        <span className="text-xs text-violet-700/80 whitespace-nowrap dark:text-violet-100/80">
                          {Math.floor(localVideoConfig.xyqAgentTimeout / 60)}分钟
                        </span>
                      </div>
                    </div>
                  </section>
                )}

                {isVolcBackend && (
                  <section className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-100">
                    <div>
                      <p className="font-medium mb-1">火山方舟 · Seedance 官方 API</p>
                      <p className="text-xs text-orange-700 dark:text-orange-100/80">
                        字节跳动火山方舟平台官方 Seedance 2.0 / 2.5 接口，支持文生视频、图生视频、视频生视频和全模态参考。
                        需在 <a href="https://console.volcengine.com/ark" target="_blank" rel="noopener" className="underline">火山方舟控制台</a> 开通模型并获取 API Key。
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="volcBaseUrl">接口地址</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              setLocalVideoConfig((prev) => ({ ...prev, volcBaseUrl: DEFAULT_VOLC_API_BASE }))
                            }
                          >
                            恢复默认
                          </Button>
                        </div>
                        <Input
                          id="volcBaseUrl"
                          placeholder={DEFAULT_VOLC_API_BASE}
                          value={localVideoConfig.volcBaseUrl || DEFAULT_VOLC_API_BASE}
                          onChange={(e) =>
                            setLocalVideoConfig((prev) => ({ ...prev, volcBaseUrl: e.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          默认官方地址为 {DEFAULT_VOLC_API_BASE}。本地调试使用默认地址时会自动走 /api/volc 代理；填写自定义网关后将按该地址请求。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="volcApiKey">API Key</Label>
                        <Input
                          id="volcApiKey"
                          type="password"
                          placeholder="火山方舟 API Key"
                          value={localVideoConfig.volcApiKey}
                          onChange={(e) =>
                            setLocalVideoConfig((prev) => ({ ...prev, volcApiKey: e.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">密钥仅存储在浏览器本地，不会上传到任何服务器</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="volcModel">视频模型</Label>
                        <Select
                          value={localVideoConfig.volcModel}
                          onValueChange={(val) =>
                            setLocalVideoConfig((prev) => ({
                              ...prev,
                              volcModel: val,
                              videoDuration: normalizeVolcVideoDuration(prev.videoDuration, 10, val),
                            }))
                          }
                        >
                          <SelectTrigger id="volcModel" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VOLC_VIDEO_MODEL_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
                      <input
                        id="volcGenerateAudio"
                        type="checkbox"
                        checked={localVideoConfig.volcGenerateAudio}
                        onChange={(e) =>
                          setLocalVideoConfig((prev) => ({ ...prev, volcGenerateAudio: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor="volcGenerateAudio" className="text-sm font-normal">
                        生成音频（generate_audio）
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      当前端点：{localVideoConfig.volcBaseUrl || DEFAULT_VOLC_API_BASE}
                    </p>
                    <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-100">
                      <p className="font-medium mb-0.5">全模态参考</p>
                      <p>
                        当前模型会按 content 顺序提交最多 {volcCapabilities.maxImages} 张 reference_image、{volcCapabilities.maxVideos} 个 reference_video、{volcCapabilities.maxAudios} 个 reference_audio。
                        {volcCapabilities.isSeedance25 ? ' 2.5 的三类素材合计最多 50 个。' : ' 旧模型限制保持不变。'}
                        同场景连续镜头会自动优先选择上一镜视频作为续写参考；音频参考需使用公网 URL。
                      </p>
                    </div>
                  </section>
                )}

                {isAliyunBackend && (
                  <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100">
                    <div>
                      <p className="mb-1 font-medium">阿里云百炼 · HappyHorse 参考生视频</p>
                      <p className="text-xs text-sky-800 dark:text-sky-100/80">
                        模型固定为 happyhorse-1.0-r2v，支持 1~9 张参考图。提交时会按百炼要求转换为 [Image 1]、[Image 2] 编号。
                        <a href="https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference?mode=pure" target="_blank" rel="noopener" className="ml-1 underline">查看文档</a>
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="aliyunApiKey">API Key</Label>
                        <Input
                          id="aliyunApiKey"
                          type="password"
                          placeholder="DashScope API Key"
                          value={localVideoConfig.aliyunApiKey}
                          onChange={(e) =>
                            setLocalVideoConfig((prev) => ({ ...prev, aliyunApiKey: e.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">密钥仅存储在浏览器本地，不会上传到任何服务器</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="aliyunModel">视频模型</Label>
                        <Select
                          value={localVideoConfig.aliyunModel || HAPPYHORSE_MODEL}
                          onValueChange={(val) =>
                            setLocalVideoConfig((prev) => ({ ...prev, aliyunModel: val }))
                          }
                        >
                          <SelectTrigger id="aliyunModel" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={HAPPYHORSE_MODEL}>happyhorse-1.0-r2v</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="aliyunRegion">地域</Label>
                        <Select
                          value={localVideoConfig.aliyunRegion || 'cn-beijing'}
                          onValueChange={(val) =>
                            setLocalVideoConfig((prev) => ({ ...prev, aliyunRegion: val }))
                          }
                        >
                          <SelectTrigger id="aliyunRegion" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cn-beijing">华北2（北京）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="aliyunSeed">Seed（可选）</Label>
                        <Input
                          id="aliyunSeed"
                          inputMode="numeric"
                          placeholder="0~2147483647"
                          value={localVideoConfig.aliyunSeed ?? ''}
                          onChange={(e) =>
                            setLocalVideoConfig((prev) => ({ ...prev, aliyunSeed: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
                      <input
                        id="aliyunWatermark"
                        type="checkbox"
                        checked={localVideoConfig.aliyunWatermark === true}
                        onChange={(e) =>
                          setLocalVideoConfig((prev) => ({ ...prev, aliyunWatermark: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor="aliyunWatermark" className="text-sm font-normal">
                        添加 HappyHorse 水印
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      API 端点：dashscope.aliyuncs.com/api/v1（通过代理访问）。720P 约 0.9 元/秒，1080P 约 1.6 元/秒；视频结果 URL 官方保留 24 小时。
                    </p>
                  </section>
                )}
              </div>
            </div>
          </TabsContent>

          {/* === 语音合成(TTS) API === */}
          <TabsContent value="tts" className="space-y-4 pt-2">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <p className="font-medium mb-1">MiMo-V2.5-TTS 语音合成</p>
              <p className="text-xs text-emerald-700">
                小米 MiMo v2.5 语音合成模型，支持预置音色、克隆音色、风格标签控制和副语言事件。
                <a href="https://platform.xiaomimimo.com" target="_blank" rel="noopener" className="underline ml-1">获取 API Key →</a>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttsBaseUrl">API 地址</Label>
              <Input
                id="ttsBaseUrl"
                placeholder="https://api.xiaomimimo.com/v1"
                value={localTtsConfig.baseUrl}
                onChange={(e) =>
                  setLocalTtsConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">MiMo TTS 接口兼容 OpenAI 格式</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttsApiKey">API Key</Label>
              <Input
                id="ttsApiKey"
                type="password"
                placeholder="MiMo API Key"
                value={localTtsConfig.apiKey}
                onChange={(e) =>
                  setLocalTtsConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">密钥仅存储在浏览器本地，不会上传到任何服务器</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttsModel">语音模型</Label>
              <Input
                id="ttsModel"
                placeholder="mimo-v2.5-tts"
                value={localTtsConfig.model}
                onChange={(e) =>
                  setLocalTtsConfig((prev) => ({ ...prev, model: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">默认 mimo-v2.5-tts；需要克隆音色时会按需自动切换到 mimo-v2.5-tts-voiceclone。</p>
            </div>
            {ttsTestResult && (
              <div
                className={`rounded-md p-3 text-sm ${
                  ttsTestResult.success
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {ttsTestResult.message}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleTtsTest}
              disabled={ttsTesting || !localTtsConfig.apiKey || !localTtsConfig.baseUrl}
            >
              {ttsTesting ? '测试中...' : '测试语音连接'}
            </Button>
          </TabsContent>

          {/* === 音乐生成 API === */}
          <TabsContent value="music" className="space-y-4 pt-2">
            <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-800">
              <p className="font-medium mb-1">MiniMax 音乐生成</p>
              <p className="text-xs text-purple-700">
                MiniMax 音乐生成模型，支持根据文本描述生成纯音乐。
                <a href="https://platform.minimaxi.com" target="_blank" rel="noopener" className="underline ml-1">获取 API Key →</a>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="musicBaseUrl">API 地址</Label>
              <Input
                id="musicBaseUrl"
                placeholder="https://api.minimaxi.com"
                value={localMusicConfig.baseUrl}
                onChange={(e) =>
                  setLocalMusicConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="musicApiKey">API Key</Label>
              <Input
                id="musicApiKey"
                type="password"
                placeholder="MiniMax API Key"
                value={localMusicConfig.apiKey}
                onChange={(e) =>
                  setLocalMusicConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">密钥仅存储在浏览器本地，不会上传到任何服务器</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="musicModel">音乐模型</Label>
              <Input
                id="musicModel"
                placeholder="music-2.6-free"
                value={localMusicConfig.model}
                onChange={(e) =>
                  setLocalMusicConfig((prev) => ({ ...prev, model: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">可选：music-2.6-free（免费版）、music-2.6（付费版）</p>
            </div>
          </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="border-t border-border/60 bg-background/95 px-5 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button onClick={handleSave}>
            保存配置
          </Button>
        </DialogFooter>
    </DialogContent>
  );
}
