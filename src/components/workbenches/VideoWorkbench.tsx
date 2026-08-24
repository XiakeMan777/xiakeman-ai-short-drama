import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrentProject } from '@/stores/projectStore';
import { uploadCloudProjectBlob } from '@/lib/cloudProjectStore';
import {
  buildSeedanceFetchInit,
  getSeedanceApiBase,
  getSeedanceCloudLicenseKey,
  getSeedanceResolutionOptions,
  getSeedanceTransit9Resolution,
  isSeedanceServiceBackend,
  normalizeSeedanceServiceDuration,
  normalizeSeedanceServiceResolution,
  normalizeVisibleSeedanceServiceModel,
  SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS,
} from '@/lib/seedanceApi';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import {
  canUseStep5BackendVideoJobs,
  pollStep5BackendJobUntilDone,
  submitStep5BackendSeedanceJob,
  type Step5BackendMediaItem,
} from '@/components/step5/backendVideoJobs';
import { Clapperboard, Download, Loader2, RotateCcw, Trash2, Upload } from '@/components/icons';
import type { SeedanceServiceModel } from '@/lib/seedanceApi';
import type { Project, VideoApiConfig, VideoBackendType } from '@/types';
import {
  createLocalMediaFiles,
  downloadUrl,
  getErrorText,
  revokeLocalMediaFiles,
  type LocalMediaFile,
} from './mediaUtils';

type VideoHistoryItem = {
  id: string;
  prompt: string;
  videoUrl: string;
  createdAt: number;
  backend: VideoBackendType;
  model: string;
  duration: number;
  ratio: string;
  referenceCount: number;
  taskId?: string;
  mode: '后台任务' | '前端直连';
};

export type VideoResolution = VideoApiConfig['videoResolution'];

const VIDEO_WORKBENCH_HISTORY_KEY = 'xkm-video-workbench-history-v1';
const SEEDANCE_POLL_INTERVAL_MS = 8000;
const SEEDANCE_TIMEOUT_MS = 120 * 60 * 1000;

function formatVideoResolutionLabel(value: string) {
  return value === '4k' ? '4K' : value.toUpperCase();
}

function loadHistory(): VideoHistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VIDEO_WORKBENCH_HISTORY_KEY) || '[]') as VideoHistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 24) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: VideoHistoryItem[]) {
  localStorage.setItem(VIDEO_WORKBENCH_HISTORY_KEY, JSON.stringify(items.slice(0, 24)));
}

function getSeedanceVideoUrlFromPayload(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  return [
    payload.video_url,
    payload.videoUrl,
    payload.official_video_url,
    payload.stable_video_url,
    payload.mp4_url,
    data?.video_url,
    data?.videoUrl,
    data?.official_video_url,
    data?.stable_video_url,
    data?.mp4_url,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function getSeedanceTaskId(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  return [
    payload.task_id,
    payload.taskId,
    payload.id,
    data?.task_id,
    data?.taskId,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function normalizeSeedanceStatus(value: unknown) {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['success', 'succeeded', 'completed', 'done', 'finish', 'finished'].includes(status)) return 'success';
  if (['failed', 'error', 'cancelled', 'canceled', 'timeout'].includes(status)) return 'failed';
  return status || 'unknown';
}

function getImageFileName(file: File, index: number) {
  const extension = file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : 'png';
  return `workbench-reference-${String(index + 1).padStart(2, '0')}.${extension}`;
}

function buildWorkbenchBlobKey(file: File, index: number) {
  const extension = file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : 'png';
  return `workbench-video-inputs/${Date.now()}-${crypto.randomUUID()}-${String(index + 1).padStart(2, '0')}.${extension}`;
}

export async function submitSeedanceStandalone(input: {
  prompt: string;
  files: File[];
  videoConfig: VideoApiConfig;
  backend: VideoBackendType;
  duration: number;
  ratio: string;
  model: SeedanceServiceModel;
  resolution: VideoResolution;
  signal: AbortSignal;
  onStatus: (text: string, progress?: number) => void;
}) {
  const videoConfig: VideoApiConfig = {
    ...input.videoConfig,
    backend: input.backend,
  };
  const apiBase = getSeedanceApiBase(videoConfig);
  const licenseKey = getSeedanceCloudLicenseKey(videoConfig);
  const formData = new FormData();
  const clientTaskId = `video-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const submitModel = normalizeVisibleSeedanceServiceModel(input.model);

  formData.append('prompt', input.prompt);
  formData.append('duration', String(input.duration));
  formData.append('ratio', normalizeFrameRatio(input.ratio));
  formData.append('model', submitModel);
  const submitResolution = input.backend === 'seedancecloud'
    ? getSeedanceTransit9Resolution(submitModel, input.resolution)
    : undefined;
  if (submitResolution) formData.append('resolution', submitResolution);
  formData.append('client_task_id', clientTaskId);
  formData.append('media_numbering', 'independent_by_type');
  formData.append('image_reference_count', String(input.files.length));
  input.files.forEach((file, index) => formData.append('images', file, getImageFileName(file, index)));

  input.onStatus('正在提交视频任务...', 8);
  const response = await fetch(`${apiBase}/generate-video`, buildSeedanceFetchInit(videoConfig, {
    method: 'POST',
    body: formData,
    signal: input.signal,
  }));
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text.slice(0, 500) || `Seedance submit HTTP ${response.status}`);
  }
  const payload = await response.json() as Record<string, unknown>;
  const taskId = getSeedanceTaskId(payload);
  if (!taskId) throw new Error('视频服务未返回 task_id');

  input.onStatus(`已提交任务 ${taskId}，正在轮询...`, 12);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= SEEDANCE_TIMEOUT_MS) {
    if (input.signal.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, SEEDANCE_POLL_INTERVAL_MS));
    const pollResponse = await fetch(`${apiBase}/task/${encodeURIComponent(taskId)}`, buildSeedanceFetchInit(videoConfig, {
      signal: input.signal,
    }));
    if (!pollResponse.ok) {
      const text = await pollResponse.text().catch(() => '');
      throw new Error(text.slice(0, 300) || `Seedance poll HTTP ${pollResponse.status}`);
    }
    const taskPayload = await pollResponse.json() as Record<string, unknown>;
    const status = normalizeSeedanceStatus(taskPayload.status);
    const progress = Number(taskPayload.progress || 0);
    input.onStatus(`视频生成中：${status} ${Number.isFinite(progress) ? progress : 0}%`, Number.isFinite(progress) ? progress : undefined);
    if (status === 'success') {
      const videoUrl = getSeedanceVideoUrlFromPayload(taskPayload) || `${apiBase}/video/${encodeURIComponent(taskId)}${licenseKey ? `?license_key=${encodeURIComponent(licenseKey)}` : ''}`;
      return { videoUrl, taskId, mode: '前端直连' as const };
    }
    if (status === 'failed') {
      throw new Error((taskPayload.error_message as string) || '视频生成失败');
    }
  }
  throw new Error('视频生成超过 120 分钟未完成');
}

export async function submitSeedanceBackendWorkbenchJob(input: {
  project: Project;
  prompt: string;
  files: File[];
  videoConfig: VideoApiConfig;
  duration: number;
  ratio: string;
  model: SeedanceServiceModel;
  resolution: VideoResolution;
  signal: AbortSignal;
  onStatus: (text: string, progress?: number) => void;
}) {
  input.onStatus('正在上传参考图到云端...', 8);
  const mediaItems: Step5BackendMediaItem[] = [];
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    const blobKey = buildWorkbenchBlobKey(file, index);
    await uploadCloudProjectBlob(input.project.id, blobKey, file);
    mediaItems.push({
      role: 'image',
      blobKey,
      fileName: getImageFileName(file, index),
      contentType: file.type || 'application/octet-stream',
    });
    input.onStatus(`参考图上传中：${index + 1}/${input.files.length}`, 8 + Math.round(((index + 1) / input.files.length) * 12));
  }

  const videoConfig: VideoApiConfig = {
    ...input.videoConfig,
    videoRatio: input.ratio,
    videoDuration: input.duration,
    seedanceModel: input.model,
    videoResolution: input.resolution,
  };
  input.onStatus('正在创建后台视频任务...', 24);
  const submitted = await submitStep5BackendSeedanceJob({
    project: input.project,
    chapterId: 'video-workbench',
    storyboardIndex: 0,
    prompt: input.prompt,
    videoConfig,
    duration: input.duration,
    productionMode: 'normal',
    images: mediaItems,
  });
  input.onStatus(`后台任务已创建：${submitted.job.id}`, 30);
  const result = await pollStep5BackendJobUntilDone(submitted.job.id, {
    signal: input.signal,
    intervalMs: 5000,
    onProgress: (job) => {
      const phase = typeof job.progress?.phase === 'string' ? job.progress.phase : job.status;
      const progress = Number(job.progress?.progress || job.progress?.percent || 0);
      input.onStatus(`后台视频任务：${phase}`, Number.isFinite(progress) && progress > 0 ? progress : undefined);
    },
  });
  return { videoUrl: result.videoUrl, taskId: result.providerTaskId || submitted.job.id, mode: '后台任务' as const };
}

export function VideoWorkbench() {
  const { state, currentProject } = useCurrentProject();
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<LocalMediaFile[]>([]);
  const [backend, setBackend] = useState<VideoBackendType>(state.videoApiConfig.backend);
  const [duration, setDuration] = useState(String(state.videoApiConfig.videoDuration || 10));
  const [ratio, setRatio] = useState(state.videoApiConfig.videoRatio || '16:9');
  const [seedanceModel, setSeedanceModel] = useState<SeedanceServiceModel>(
    normalizeVisibleSeedanceServiceModel(state.videoApiConfig.seedanceModel),
  );
  const [resolution, setResolution] = useState<VideoResolution>(state.videoApiConfig.videoResolution || '720p');
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [taskId, setTaskId] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<VideoHistoryItem[]>(() => loadHistory());
  const abortRef = useRef<AbortController | null>(null);

  const supportsSeedanceModel = isSeedanceServiceBackend(backend);
  const backendLabel = backend === 'seedancecloud'
    ? '虾客漫 SD2 / Seedance'
    : backend === 'seedance'
      ? '本地 Seedance'
      : backend === 'hmapi'
        ? 'HM API（已弃用）'
        : backend === 'xyqagent'
          ? '虾客漫 Agent'
          : backend === 'volcengine'
            ? '火山方舟'
            : backend === 'aliyunbailian'
              ? '阿里云百炼'
              : '当前视频服务';
  const unsupportedReason = backend === 'hmapi'
    ? 'HM 视频接口已弃用，请在 API 设置中切换到虾客漫 SD2 或 Seedance 后再使用视频工作台。'
    : supportsSeedanceModel
      ? ''
      : '当前视频服务暂未接入独立视频工作台，请在 API 设置中切换到虾客漫 SD2 / Seedance，或继续在 Step5 中生成视频。';
  const canSubmit = prompt.trim().length >= 8 && files.length > 0 && !running && supportsSeedanceModel;
  const seedanceResolutionOptions = getSeedanceResolutionOptions(seedanceModel);

  useEffect(() => () => {
    revokeLocalMediaFiles(files);
    abortRef.current?.abort();
  }, [files]);

  useEffect(() => {
    setBackend(state.videoApiConfig.backend);
    setDuration(String(state.videoApiConfig.videoDuration || 10));
    setRatio(state.videoApiConfig.videoRatio || '16:9');
    const nextModel = normalizeVisibleSeedanceServiceModel(state.videoApiConfig.seedanceModel);
    setSeedanceModel(nextModel);
    setResolution(normalizeSeedanceServiceResolution(nextModel, state.videoApiConfig.videoResolution || '720p'));
  }, [state.videoApiConfig]);

  const modelLabel = useMemo(() => {
    if (backend === 'hmapi') return state.videoApiConfig.hmapiModel || 'HM API';
    if (backend === 'xyqagent') return '虾客漫 Agent';
    if (backend === 'volcengine') return state.videoApiConfig.volcModel || '火山方舟视频';
    if (backend === 'aliyunbailian') return state.videoApiConfig.aliyunModel || '阿里云百炼视频';
    return seedanceModel;
  }, [backend, seedanceModel, state.videoApiConfig.aliyunModel, state.videoApiConfig.hmapiModel, state.videoApiConfig.volcModel]);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const next = createLocalMediaFiles(fileList, '参考图');
    setFiles((prev) => [...prev, ...next].slice(0, 9));
  };

  const setStatus = (text: string, nextProgress?: number) => {
    setStatusText(text);
    if (typeof nextProgress === 'number' && Number.isFinite(nextProgress)) {
      setProgress(Math.max(0, Math.min(100, Math.round(nextProgress))));
    }
  };

  const recordHistory = (url: string, providerTaskId: string | undefined, mode: VideoHistoryItem['mode']) => {
    const item: VideoHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: prompt.trim(),
      videoUrl: url,
      createdAt: Date.now(),
      backend,
      model: modelLabel,
      duration: normalizeSeedanceServiceDuration(duration),
      ratio,
      referenceCount: files.length,
      taskId: providerTaskId,
      mode,
    };
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 24);
      saveHistory(next);
      return next;
    });
  };

  const runGenerate = async () => {
    if (!canSubmit) return;
    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;
    setRunning(true);
    setVideoUrl('');
    setTaskId('');
    setProgress(0);
    setStatus('准备提交视频任务...', 3);
    try {
      let resultUrl = '';
      let providerTaskId = '';
      let mode: VideoHistoryItem['mode'] = '前端直连';
      const selectedDuration = normalizeSeedanceServiceDuration(duration);
      const selectedResolution = normalizeSeedanceServiceResolution(seedanceModel, resolution);
      if (!supportsSeedanceModel) throw new Error(unsupportedReason || '当前视频服务暂不支持视频工作台');
      const videoConfig: VideoApiConfig = {
        ...state.videoApiConfig,
        backend,
        videoRatio: ratio,
        videoDuration: selectedDuration,
        seedanceModel,
        videoResolution: selectedResolution,
      };
      const canUseBackendJob = currentProject ? await canUseStep5BackendVideoJobs(videoConfig) : false;
      const submitted = canUseBackendJob && currentProject
        ? await submitSeedanceBackendWorkbenchJob({
            project: currentProject,
            prompt: prompt.trim(),
            files: files.map((file) => file.file),
            videoConfig,
            duration: selectedDuration,
            ratio,
            model: seedanceModel,
            resolution: selectedResolution,
            signal: abortCtrl.signal,
            onStatus: setStatus,
          })
        : await submitSeedanceStandalone({
            prompt: prompt.trim(),
            files: files.map((file) => file.file),
            videoConfig,
            backend,
            duration: selectedDuration,
            ratio,
            model: seedanceModel,
            resolution: selectedResolution,
            signal: abortCtrl.signal,
            onStatus: setStatus,
          });
      resultUrl = submitted.videoUrl;
      providerTaskId = submitted.taskId;
      mode = submitted.mode;
      setTaskId(submitted.taskId);
      if (abortCtrl.signal.aborted) return;
      setVideoUrl(resultUrl);
      setProgress(100);
      setStatus('视频生成完成', 100);
      recordHistory(resultUrl, providerTaskId, mode);
      toast.success('视频已生成');
    } catch (error) {
      if (!abortCtrl.signal.aborted) {
        setStatus(`生成失败：${getErrorText(error)}`);
        toast.error(`视频生成失败：${getErrorText(error)}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="xkm-media-workbench animate-fade-in">
      <section className="xkm-media-command">
        <div>
          <p className="xkm-hub-eyebrow">视频工作台</p>
          <h2>独立视频生成</h2>
          <p>上传参考图，输入视频提示词，使用当前 API 设置中的视频服务生成单条视频。</p>
        </div>
        <div className="xkm-media-command-status">
          <Badge variant="outline">{backendLabel}</Badge>
          <Badge variant="outline">{modelLabel}</Badge>
          <Badge variant="outline">{currentProject ? '优先后台任务' : '前端直连'}</Badge>
        </div>
      </section>

      <div className="xkm-media-layout">
        <section className="xkm-media-panel">
          <div className="xkm-media-panel-head">
            <div>
              <h3>生成设置</h3>
              <p>参考图会按上传顺序提交给视频模型。</p>
            </div>
            {running && <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />}
          </div>

          {unsupportedReason && (
            <div className="xkm-status-line is-error">
              {unsupportedReason}
            </div>
          )}

          <Label className="xkm-field">
            <span>视频提示词</span>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述镜头、主体、动作、环境、声音和结尾停顿..."
              className="min-h-[170px]"
            />
          </Label>

          <div className="xkm-form-grid">
            <Label className="xkm-field">
              <span>视频服务</span>
              <Input value={backendLabel} readOnly />
            </Label>
            <Label className="xkm-field">
              <span>画幅</span>
              <Select value={ratio} onValueChange={setRatio}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 横版</SelectItem>
                  <SelectItem value="9:16">9:16 竖版</SelectItem>
                  <SelectItem value="1:1">1:1 方版</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label className="xkm-field">
              <span>时长</span>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[4, 5, 6, 8, 10, 12, 15].map((value) => (
                    <SelectItem key={value} value={String(value)}>{value} 秒</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            {supportsSeedanceModel && (
              <Label className="xkm-field">
                <span>模型</span>
                <Select
                  value={seedanceModel}
                  onValueChange={(value) => {
                    const nextModel = value as SeedanceServiceModel;
                    setSeedanceModel(nextModel);
                    setResolution(normalizeSeedanceServiceResolution(nextModel, resolution));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
            {supportsSeedanceModel && (
              <Label className="xkm-field">
                <span>分辨率</span>
                <Select value={resolution} onValueChange={(value) => setResolution(value as VideoResolution)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {seedanceResolutionOptions.map((value) => (
                      <SelectItem key={value} value={value}>{formatVideoResolutionLabel(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
          </div>

          <Label className="xkm-upload-box is-wide">
            <Upload className="h-4 w-4" />
            <span>上传视频参考图</span>
            <small>建议 1-9 张，顺序就是模型读取顺序</small>
            <Input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
          </Label>

          {files.length > 0 && (
            <div className="xkm-reference-strip">
              {files.map((file) => (
                <div key={file.id} className="xkm-reference-thumb">
                  <img src={file.url} alt={file.label} />
                  <span>{file.label}</span>
                  <button
                    type="button"
                    aria-label={`移除${file.label}`}
                    onClick={() => {
                      revokeLocalMediaFiles([file]);
                      setFiles((prev) => prev.filter((item) => item.id !== file.id));
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="xkm-action-row">
            <Button type="button" className="brand-gradient" disabled={!canSubmit} onClick={runGenerate}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
              {running ? '生成中' : '生成视频'}
            </Button>
            <Button type="button" variant="outline" disabled={!running} onClick={() => abortRef.current?.abort()}>
              停止
            </Button>
            <Button type="button" variant="ghost" disabled={!videoUrl} onClick={() => setVideoUrl('')}>
              <RotateCcw className="h-4 w-4" />
              清空结果
            </Button>
          </div>

          {(statusText || running) && (
            <div className="xkm-progress-block">
              <div><span>{statusText || '等待中'}</span><strong>{progress}%</strong></div>
              <div className="xkm-progress-track"><i style={{ width: `${progress}%` }} /></div>
              {taskId && <small>任务号：{taskId}</small>}
            </div>
          )}
        </section>

        <section className="xkm-media-preview">
          {videoUrl ? (
            <>
              <video src={videoUrl} controls playsInline />
              <div className="xkm-preview-actions">
                <span>视频生成完成</span>
                <Button type="button" size="sm" onClick={() => downloadUrl(videoUrl, `xkm-video-${Date.now()}.mp4`)}>
                  <Download className="h-3.5 w-3.5" />
                  下载
                </Button>
              </div>
            </>
          ) : (
            <div className="xkm-empty-preview">
              <Clapperboard className="h-8 w-8" />
              <span>视频结果会显示在这里</span>
            </div>
          )}
        </section>
      </div>

      <section className="xkm-media-history">
        <div className="xkm-media-panel-head">
          <div>
            <h3>本机历史</h3>
            <p>记录最近生成的视频链接。后台任务完成后即使刷新，也可以在任务中心继续补救。</p>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="xkm-history-empty">暂无视频历史</div>
        ) : (
          <div className="xkm-video-history-list">
            {history.map((item) => (
              <button key={item.id} type="button" className="xkm-video-history-row" onClick={() => setVideoUrl(item.videoUrl)}>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <strong>{item.model}</strong>
                <small>{item.duration}s / {item.ratio} / {item.referenceCount} 张参考</small>
                <Badge variant="outline">{item.mode}</Badge>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
