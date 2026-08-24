import { useState } from 'react';
import { ChevronDown, ChevronUp, Settings } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  getVideoBackendDisplayName,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import {
  isVideoExtensionEnabled,
  supportsVideoExtensionBackend,
} from './videoExtensionConfig';
import type { VideoApiConfig } from '@/types';
import type { Action } from '@/stores/projectStore';
import type { Dispatch } from 'react';
import {
  DEFAULT_SEEDANCE_CLOUD_API_BASE,
  SEEDANCE_SERVICE_DURATIONS,
  SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS,
  isSeedanceServiceBackend,
  normalizeSeedanceServiceDuration,
  normalizeSeedanceServiceResolution,
  normalizeVisibleSeedanceServiceModel,
} from '@/lib/seedanceApi';
import { DEFAULT_VOLC_API_BASE } from '@/lib/volcengineApiClient';

export function VideoQuickParams({
  videoConfig,
  dispatch,
  currentSubmitDurationSeconds,
  requiresVolcengineForOfficialVirtualHuman = false,
}: {
  videoConfig: VideoApiConfig;
  dispatch: Dispatch<Action>;
  currentSubmitDurationSeconds?: number;
  requiresVolcengineForOfficialVirtualHuman?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const backend = videoConfig.backend;
  const isSeedanceCloud = backend === 'seedancecloud';
  const isAliyunBailian = backend === 'aliyunbailian';
  const effectiveVideoDuration = normalizeSeedanceServiceDuration(videoConfig.videoDuration);
  const durationSummary = typeof currentSubmitDurationSeconds === 'number'
    && Number.isFinite(currentSubmitDurationSeconds)
    && currentSubmitDurationSeconds !== effectiveVideoDuration
    ? `提交 ${currentSubmitDurationSeconds}s / 设置 ${effectiveVideoDuration}s`
    : `${effectiveVideoDuration}s`;
  const effectiveSeedanceModel = normalizeVisibleSeedanceServiceModel(videoConfig.seedanceModel);
  const officialBackendReady = isOfficialVirtualHumanCompatibleVideoBackend(backend);
  const officialBackendBlocked = requiresVolcengineForOfficialVirtualHuman && !officialBackendReady;
  const extensionSupported = supportsVideoExtensionBackend(backend);
  const extensionEnabled = isVideoExtensionEnabled(videoConfig);
  const extensionCopy = backend === 'volcengine'
    ? '火山方舟会走官方全能参考多参模式：9 张参考图 + 最多 3 个同场景参考视频 + 最多 3 个公共音频 URL。视频1负责直接续写，视频2/3只约束空间、站位和风格。'
    : isSeedanceServiceBackend(backend)
      ? '小云雀会把上一镜视频交给服务端模拟延长，适合作为火山方舟不可用时的备用通道。'
      : '当前后端暂不支持上一镜参考视频；同场景连续镜头会按普通图生视频生成。';
  const volcAudioText = (videoConfig.volcReferenceAudioUrls ?? []).join('\n');

  const updateConfig = (patch: Partial<VideoApiConfig>) => {
    dispatch({ type: 'SET_VIDEO_API_CONFIG', config: { ...videoConfig, ...patch } });
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-white/70 bg-white/60 px-3 py-1.5 text-left text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground dark:border-white/10 dark:bg-white/5"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 font-medium shadow-sm dark:bg-white/10">
            <Settings className="h-3 w-3" />
            视频参数
          </span>
          <span className="text-[10px]">
            {getVideoBackendDisplayName(backend)} · {durationSummary} · {videoConfig.videoRatio}
            {backend === 'volcengine' && videoConfig.volcGenerateAudio && ' · 含音频'}
            {' · '}
            {isSeedanceServiceBackend(backend)
              ? `延时 ${videoConfig.seedanceBatchDelay ?? 100}s`
              : backend === 'xyqagent'
                ? '串行提交'
              : backend === 'aliyunbailian'
                ? 'HappyHorse 多图参考'
              : backend === 'volcengine' && extensionEnabled
                ? '连续镜头自动串行'
                : `并发 ${videoConfig.batchConcurrency || 3}`}
            {requiresVolcengineForOfficialVirtualHuman && (
              officialBackendReady ? ' · 官方脸可用' : ' · 官方脸需火山方舟'
            )}
            {extensionSupported && (
              extensionEnabled
                ? backend === 'volcengine' ? ' · 全能参考多参' : ' · 连续镜头延长'
                : ' · 连续镜头关闭'
            )}
            {videoConfig.characterVoiceReferencesEnabled === true ? ' · 角色声线开启' : ' · 角色声线关闭'}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-4 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground dark:border-white/10 dark:bg-white/5">
            先确定视频后端、时长和画幅，再决定是否启用音频、提高并发或拉长本地超时。这里的参数会直接影响整章视频生成速度和稳定性。
          </div>

          <div className="flex items-start justify-between gap-3 rounded-2xl border border-cyan-200/70 bg-cyan-50/70 p-3 text-cyan-900 dark:border-cyan-400/25 dark:bg-cyan-500/10 dark:text-cyan-100">
            <div className="space-y-1">
              <Label className="text-xs">角色配音参考</Label>
              <p className="text-[10px] leading-5">
                开启后，Step4 会把当前分镜最多 3 位说话角色写进声线要求；小云雀和火山方舟都按 @音频1-3 提交音频参考，图片编号单独计算。
              </p>
            </div>
            <Switch
              checked={videoConfig.characterVoiceReferencesEnabled === true}
              onCheckedChange={(checked) => updateConfig({ characterVoiceReferencesEnabled: checked })}
              aria-label="角色配音参考"
            />
          </div>

          {requiresVolcengineForOfficialVirtualHuman && (
            <div className={`rounded-2xl border px-3 py-2 text-[11px] leading-relaxed ${
              officialBackendReady
                ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100'
            }`}
            >
              <div className="font-semibold">官方虚拟人脸库仅支持火山方舟视频模型</div>
              <div className="mt-1">
                {officialBackendReady
                  ? '当前已选择火山方舟，Step5 会把官方身份图按 asset:// 参考图提交。'
                  : getOfficialVirtualHumanIncompatibleMessage(backend)}
              </div>
              {officialBackendBlocked && (
                <button
                  type="button"
                  onClick={() => updateConfig({ backend: 'volcengine' })}
                  className="mt-2 rounded-xl border border-amber-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-white dark:border-amber-400/40 dark:bg-white/10 dark:text-amber-50"
                >
                  切换到火山方舟
                </button>
              )}
            </div>
          )}

          <div className="space-y-2 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
            <Label className="text-xs font-medium">视频后端</Label>
            <div className="flex flex-wrap gap-2">
              {([
                ['seedance', '小云雀'],
                ['seedancecloud', '虾客漫SD2'],
                ['xyqagent', '小云雀 Agent'],
                ['volcengine', '火山方舟'],
                ['aliyunbailian', '百炼 HappyHorse'],
              ] as const).map(([value, label]) => {
                const blocked = requiresVolcengineForOfficialVirtualHuman && value !== 'volcengine';
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      if (!blocked) {
                        updateConfig({
                          backend: value,
                          ...(value === 'seedancecloud'
                            ? { videoResolution: normalizeSeedanceServiceResolution(effectiveSeedanceModel, videoConfig.videoResolution) }
                            : {}),
                          ...(value === 'aliyunbailian' && (videoConfig.videoResolution === '480p' || videoConfig.videoResolution === '4k')
                            ? { videoResolution: '720p' as const }
                            : {}),
                          ...(value === 'volcengine' && videoConfig.videoResolution === '4k'
                            ? { videoResolution: '1080p' as const }
                            : {}),
                        });
                      }
                    }}
                    disabled={blocked}
                    title={blocked ? '官方虚拟人脸库只支持火山方舟视频模型' : undefined}
                    className={`rounded-xl px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      backend === value
                        ? 'border border-primary/30 bg-primary/10 text-primary font-medium shadow-sm dark:border-primary/40 dark:bg-primary/15 dark:text-primary-foreground'
                        : 'border border-muted bg-background/70 text-muted-foreground hover:border-muted-foreground/50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:border-slate-500'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
              <Label className="text-xs">时长（秒）</Label>
              <div className="grid grid-cols-4 gap-1.5">
                  {SEEDANCE_SERVICE_DURATIONS.map((duration) => (
                    <button
                      key={duration}
                      type="button"
                      onClick={() => updateConfig({ videoDuration: duration })}
                      className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                        effectiveVideoDuration === duration
                          ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                          : 'border-muted bg-background/60 text-muted-foreground hover:border-muted-foreground/50'
                      }`}
                    >
                      {duration}s
                    </button>
                  ))}
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                所有视频模型统一支持 4-15 秒整数；提交时优先使用当前分镜在 Step4 中写明的时长，这里只作兜底。
              </p>
            </div>
            <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
              <Label className="text-xs">全局成片画幅</Label>
              <select
                value={videoConfig.videoRatio || '16:9'}
                onChange={(e) => updateConfig({ videoRatio: e.target.value })}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="9:16">9:16（竖屏）</option>
                <option value="16:9">16:9（横屏）</option>
              </select>
              <p className="text-[10px] leading-4 text-muted-foreground">
                同步影响 Step4 参考图、定位图和 Step5 视频比例。
              </p>
            </div>
          </div>

          {backend === 'volcengine' && (
            <>
              <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <input
                  type="checkbox"
                  id="volcGenerateAudio"
                  checked={videoConfig.volcGenerateAudio}
                  onChange={(e) => updateConfig({ volcGenerateAudio: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-muted-foreground"
                />
                <Label htmlFor="volcGenerateAudio" className="text-xs">生成音频</Label>
              </div>
              {videoConfig.volcGenerateAudio && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                  后续还有独立 TTS 配音与成片混音；如果希望最终只使用 TTS 台词和统一音效，建议关闭火山视频原生音频，避免叠音或对白口型声轨不一致。
                </div>
              )}
              <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">火山方舟接口地址</Label>
                  <button
                    type="button"
                    onClick={() => updateConfig({ volcBaseUrl: DEFAULT_VOLC_API_BASE })}
                    className="text-[10px] font-medium text-primary hover:underline"
                  >
                    恢复默认
                  </button>
                </div>
                <Input
                  value={videoConfig.volcBaseUrl || DEFAULT_VOLC_API_BASE}
                  onChange={(e) => updateConfig({ volcBaseUrl: e.target.value })}
                  placeholder={DEFAULT_VOLC_API_BASE}
                  className="h-8 text-xs"
                />
                <p className="text-[10px] leading-5 text-muted-foreground">
                  默认地址会按环境自动走官方直连或本地代理；自定义地址会直接用于提交、查询和删除任务。
                </p>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <Label className="text-xs">火山方舟模型</Label>
                <Input
                  value={videoConfig.volcModel || ''}
                  onChange={(e) => updateConfig({ volcModel: e.target.value })}
                  placeholder="doubao-seedance-2-0-260128-fast"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-2 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <Label className="text-xs">reference_audio 公共 URL（最多 3 个）</Label>
                <Textarea
                  value={volcAudioText}
                  onChange={(e) => updateConfig({
                    volcReferenceAudioUrls: e.target.value
                      .split(/\r?\n/)
                      .map((url) => url.trim())
                      .filter(Boolean)
                      .slice(0, 3),
                  })}
                  placeholder="https://example.com/dialogue-guide.mp3"
                  className="min-h-[72px] text-xs"
                />
                <p className="text-[10px] leading-5 text-muted-foreground">
                  仅填写可被火山方舟访问的公网音频 URL；本地 TTS Blob 不会伪装成官方音频参考，避免提交失败。
                </p>
              </div>
            </>
          )}

          {isAliyunBailian && (
            <>
              <div className="rounded-2xl border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-[11px] leading-relaxed text-sky-900 dark:border-sky-400/25 dark:bg-sky-500/10 dark:text-sky-100">
                百炼 HappyHorse 走参考生视频接口，当前参考图会按 [Image 1] 到 [Image 9] 提交；480p 会自动按 720P 提交。
              </div>
              <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <Label className="text-xs">DashScope API Key</Label>
                <Input
                  type="password"
                  value={videoConfig.aliyunApiKey ?? ''}
                  onChange={(e) => updateConfig({ aliyunApiKey: e.target.value })}
                  placeholder="阿里云百炼 API Key"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                  <Label className="text-xs">HappyHorse 模型</Label>
                  <Input
                    value={videoConfig.aliyunModel || 'happyhorse-1.0-r2v'}
                    onChange={(e) => updateConfig({ aliyunModel: e.target.value })}
                    placeholder="happyhorse-1.0-r2v"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                  <Label className="text-xs">Seed（可选）</Label>
                  <Input
                    inputMode="numeric"
                    value={videoConfig.aliyunSeed ?? ''}
                    onChange={(e) => updateConfig({ aliyunSeed: e.target.value })}
                    placeholder="0~2147483647"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <input
                  type="checkbox"
                  id="aliyunWatermarkQuick"
                  checked={videoConfig.aliyunWatermark === true}
                  onChange={(e) => updateConfig({ aliyunWatermark: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-muted-foreground"
                />
                <Label htmlFor="aliyunWatermarkQuick" className="text-xs">添加 HappyHorse 水印</Label>
              </div>
            </>
          )}

          <div className={`flex items-start justify-between gap-3 rounded-2xl border p-3 ${
            extensionSupported
              ? 'border-blue-200/70 bg-blue-50/70 text-blue-900 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-100'
              : 'border-white/70 bg-white/60 text-muted-foreground dark:border-slate-700/70 dark:bg-slate-900/55'
          }`}
          >
            <div className="space-y-1">
              <Label className="text-xs">
                {backend === 'volcengine' ? '同场景全能参考' : '同场景连续镜头延长'}
              </Label>
              <p className="text-[10px] leading-5">
                {extensionCopy}
              </p>
            </div>
            <Switch
              checked={extensionSupported && extensionEnabled}
              disabled={!extensionSupported}
              onCheckedChange={(checked) => updateConfig({
                useVideoExtension: checked,
                seedanceUseVideoExtension: checked,
              })}
              aria-label={backend === 'volcengine' ? '同场景全能参考' : '同场景连续镜头延长'}
            />
          </div>

          {isSeedanceServiceBackend(backend) && (
            <>
              {isSeedanceCloud && (
                <>
                  <div className="rounded-2xl border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-[11px] leading-relaxed text-sky-900 dark:border-sky-500/25 dark:bg-slate-950/70 dark:text-sky-100">
                    虾客漫SD2会调用独立云端服务，任务按卡密派生身份隔离，账号池由云端后台统一维护。原本地小云雀配置不受影响。
                  </div>
                  <div className="space-y-2 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-sky-500/20 dark:bg-slate-900/70">
                    <Label className="text-xs">虾客漫SD2 视频模型</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateConfig({
                            seedanceModel: option.value,
                            videoResolution: normalizeSeedanceServiceResolution(option.value, videoConfig.videoResolution),
                          })}
                          className={`rounded-lg border px-2 py-1.5 text-left text-xs leading-4 transition-colors ${
                            effectiveSeedanceModel === option.value
                              ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                              : 'border-muted bg-background/60 text-muted-foreground hover:border-muted-foreground/50'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      虾客漫SD2 当前提供 Seedance2.0 Mini、Fast 和满血；Mini/Fast 支持 480p/720p，满血支持到 4K。
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-sky-500/20 dark:bg-slate-900/70">
                      <Label className="text-xs">云端接口地址</Label>
                      <Input
                        value={videoConfig.seedanceCloudBaseUrl || DEFAULT_SEEDANCE_CLOUD_API_BASE}
                        onChange={(e) => updateConfig({ seedanceCloudBaseUrl: e.target.value })}
                        placeholder={DEFAULT_SEEDANCE_CLOUD_API_BASE}
                        className="h-8 text-xs"
                      />
                      <p className="text-[10px] leading-4 text-muted-foreground">
                        默认直连虾客漫SD2 云端地址，填写主机即可自动补 /api；如接入域名或代理，可在这里替换。
                      </p>
                    </div>
                    <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-sky-500/20 dark:bg-slate-900/70">
                      <Label className="text-xs">云端卡密</Label>
                      <Input
                        value={videoConfig.seedanceCloudLicenseKey ?? ''}
                        onChange={(e) => updateConfig({ seedanceCloudLicenseKey: e.target.value })}
                        placeholder="输入购买或分配的卡密"
                        className="h-8 text-xs"
                      />
                      <p className="text-[10px] leading-4 text-muted-foreground">
                        请求会携带 X-License-Key，云端用卡密派生隔离身份，不再由前端传任意用户 ID。
                      </p>
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <Label className="text-xs">⏱️ 任务超时时间</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={60}
                    max={7200}
                    step={60}
                    value={videoConfig.seedanceTimeout ?? 7200}
                    onChange={(e) => updateConfig({ seedanceTimeout: Math.max(60, Math.min(7200, parseInt(e.target.value, 10) || 7200)) })}
                    className="h-8 w-24 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    秒（{Math.floor((videoConfig.seedanceTimeout ?? 7200) / 60)} 分钟）
                  </span>
                </div>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <Label className="text-xs">⏳ 批量提交延时</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={300}
                    step={5}
                    value={videoConfig.seedanceBatchDelay ?? 100}
                    onChange={(e) => updateConfig({ seedanceBatchDelay: Math.max(0, Math.min(300, parseInt(e.target.value, 10) || 100)) })}
                    className="h-8 w-20 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {videoConfig.seedanceBatchDelay === 0 ? '无延时连续提交' : `每 ${videoConfig.seedanceBatchDelay ?? 100} 秒提交下一个`}
                  </span>
                </div>
              </div>

              <p className="rounded-2xl border border-dashed border-white/70 bg-white/50 px-3 py-2 text-[10px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                {isSeedanceCloud
                  ? '虾客漫SD2默认直连云端服务；用户只需要填写卡密，账号池由云端后台统一维护。'
                  : '小云雀本地后端模型固定为 Seedance 2.0 Fast，需要本地运行 Flask 后端（:8033）并配置 Cookie。'}
              </p>
            </>
          )}

          {backend === 'xyqagent' && (
            <>
              <div className="rounded-2xl border border-violet-200/70 bg-violet-50/70 px-3 py-2 text-[11px] leading-relaxed text-violet-900 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-100">
                <span className="block">小云雀 Agent 会把视频参数写进消息开头：生成一个 {videoConfig.videoDuration || 5} 秒视频，{videoConfig.videoRatio || '16:9'}，{videoConfig.videoResolution || '720p'}，使用 Seedance 2.0 Fast。</span>
                <span className="mt-1 block">你只需要填 Access Key；官方没有模型选择，这里会自动走 Seedance 2.0 Fast VIP 模型。</span>
                <a
                  href="https://bytedance.larkoffice.com/wiki/JUlowWl8Bi6X8fkTKrYc70zRnVc"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex font-medium underline underline-offset-2 hover:opacity-80"
                >
                  详细文档介绍
                </a>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                <Label className="text-xs">Access Key</Label>
                <Input
                  type="password"
                  value={videoConfig.xyqAgentAccessKey ?? ''}
                  onChange={(e) => updateConfig({ xyqAgentAccessKey: e.target.value })}
                  placeholder="小云雀 Agent Access Key"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                  <Label className="text-xs">Agent Base URL</Label>
                  <Input
                    value={videoConfig.xyqAgentBaseUrl}
                    onChange={(e) => updateConfig({ xyqAgentBaseUrl: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
                  <Label className="text-xs">任务超时</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={60}
                      max={7200}
                      step={60}
                      value={videoConfig.xyqAgentTimeout ?? 1800}
                      onChange={(e) => updateConfig({ xyqAgentTimeout: Math.max(60, Math.min(7200, parseInt(e.target.value, 10) || 1800)) })}
                      className="h-8 w-24 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      秒（{Math.floor((videoConfig.xyqAgentTimeout ?? 1800) / 60)} 分钟）
                    </span>
                  </div>
                </div>
                <p className="rounded-2xl border border-dashed border-white/70 bg-white/50 px-3 py-2 text-[10px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                  小云雀 Agent 批量提交会按 1 个任务串行排队，不另外走“批量并发数”。
                </p>
              </div>
            </>
          )}

          {!isSeedanceServiceBackend(backend) && backend !== 'xyqagent' && !(backend === 'volcengine' && extensionEnabled) && (
            <div className="space-y-1 rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/55">
              <Label className="text-xs">批量并发数</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={videoConfig.batchConcurrency || 3}
                  onChange={(e) => updateConfig({ batchConcurrency: Math.max(1, Math.min(10, Number(e.target.value) || 3)) })}
                  className="h-8 w-20 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">1~10，建议 3</span>
              </div>
            </div>
          )}

          {backend === 'volcengine' && extensionEnabled && (
            <div className="rounded-2xl border border-blue-200/70 bg-blue-50/70 px-3 py-2 text-[11px] leading-relaxed text-blue-900 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-100">
              火山方舟全能参考开启后，本集批量生成会自动改为 1 个任务串行执行；同场景后续镜头会提交最多 3 个 reference_video，确保视频1已完成并保留远程 video_url。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
