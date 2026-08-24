import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrentProject } from '@/stores/projectStore';
import { generateImage } from '@/lib/imageApiClient';
import { Download, ImageIcon, Loader2, Plus, RotateCcw, Sparkles, Trash2, Upload } from '@/components/icons';
import type { ImageSize } from '@/types';
import {
  createLocalMediaFiles,
  downloadUrl,
  formatBytes,
  getErrorText,
  revokeLocalMediaFiles,
  type LocalMediaFile,
} from './mediaUtils';

type AspectRatio = 'PORTRAIT' | 'LANDSCAPE' | 'SQUARE';

type ImageHistoryItem = {
  id: string;
  prompt: string;
  url: string;
  createdAt: number;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  model: string;
  referenceCount: number;
};

const IMAGE_WORKBENCH_HISTORY_KEY = 'xkm-image-workbench-history-v1';

function loadHistory(): ImageHistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMAGE_WORKBENCH_HISTORY_KEY) || '[]') as ImageHistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 24) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: ImageHistoryItem[]) {
  localStorage.setItem(IMAGE_WORKBENCH_HISTORY_KEY, JSON.stringify(items.slice(0, 24)));
}

export function ImageWorkbench() {
  const { state, currentProject } = useCurrentProject();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('LANDSCAPE');
  const [imageSize, setImageSize] = useState<ImageSize>(state.imageApiConfig.defaultImageSize ?? '2K');
  const [sourceFiles, setSourceFiles] = useState<LocalMediaFile[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<LocalMediaFile[]>([]);
  const [statusText, setStatusText] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [history, setHistory] = useState<ImageHistoryItem[]>(() => loadHistory());
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const canSubmit = prompt.trim().length >= 4 && !running;
  const activeModel = state.imageApiConfig.model || '未配置模型';
  const referenceCount = sourceFiles.length + referenceFiles.length;
  const primarySource = sourceFiles[0];

  useEffect(() => () => {
    revokeLocalMediaFiles(sourceFiles);
    revokeLocalMediaFiles(referenceFiles);
    if (resultUrl?.startsWith('blob:')) URL.revokeObjectURL(resultUrl);
    abortRef.current?.abort();
  }, [sourceFiles, referenceFiles, resultUrl]);

  const modeLabel = useMemo(() => {
    if (primarySource && referenceFiles.length > 0) return '图生图 + 多参考';
    if (primarySource) return '图生图';
    if (referenceFiles.length > 0) return '多参考生图';
    return '文生图';
  }, [primarySource, referenceFiles.length]);

  const handleSourceFiles = (files: FileList | null) => {
    if (!files?.length) return;
    revokeLocalMediaFiles(sourceFiles);
    setSourceFiles(createLocalMediaFiles([files[0]], '源图'));
  };

  const handleReferenceFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next = createLocalMediaFiles(files, '参考图');
    setReferenceFiles((prev) => [...prev, ...next].slice(0, 12));
  };

  const clearResult = () => {
    if (resultUrl?.startsWith('blob:')) URL.revokeObjectURL(resultUrl);
    setResultUrl('');
    setResultBlob(null);
  };

  const runGenerate = async () => {
    if (!canSubmit) return;
    clearResult();
    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;
    setRunning(true);
    setStatusText('正在提交图片任务...');
    try {
      const result = await generateImage(state.imageApiConfig, {
        prompt: prompt.trim(),
        aspectRatio,
        imageSize,
        sourceBlob: primarySource?.file,
        sourceLabel: primarySource ? '主参考图，锁定构图、人物或画面关系' : undefined,
        referenceBlobs: referenceFiles.map((file) => file.file),
        referenceLabels: referenceFiles.map((file, index) => file.label || `参考图${index + 1}`),
        signal: abortCtrl.signal,
        onStatus: setStatusText,
        onRemoteImageUrl: (url) => setStatusText(`远程图片已生成，正在取回：${url.slice(0, 52)}...`),
        background: {
          enabled: !!currentProject,
          projectId: currentProject?.id,
          namespace: 'image-workbench',
          requireBackend: false,
        },
      }, state.videoApiConfig);
      if (abortCtrl.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      setResultBlob(result.blob);
      setResultUrl(url);
      setStatusText('图片生成完成');
      const item: ImageHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: prompt.trim(),
        url,
        createdAt: Date.now(),
        aspectRatio,
        imageSize,
        model: result.sourceModel || activeModel,
        referenceCount,
      };
      setHistory((prev) => {
        const next = [item, ...prev].slice(0, 24);
        saveHistory(next.map((entry) => ({ ...entry, url: entry.url.startsWith('blob:') ? '' : entry.url })));
        return next;
      });
      toast.success('图片已生成');
    } catch (error) {
      if (!abortCtrl.signal.aborted) {
        setStatusText(`生成失败：${getErrorText(error)}`);
        toast.error(`图片生成失败：${getErrorText(error)}`);
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
          <p className="xkm-hub-eyebrow">图片工作台</p>
          <h2>独立图片生成</h2>
          <p>支持文生图、图生图和多参考图。使用当前 API 设置中的图片模型，生成结果不会改动短剧项目流程。</p>
        </div>
        <div className="xkm-media-command-status">
          <Badge variant="outline">{modeLabel}</Badge>
          <Badge variant="outline">{activeModel}</Badge>
        </div>
      </section>

      <div className="xkm-media-layout">
        <section className="xkm-media-panel">
          <div className="xkm-media-panel-head">
            <div>
              <h3>生成设置</h3>
              <p>输入提示词，按需上传源图和参考图。</p>
            </div>
            {running && <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />}
          </div>

          <Label className="xkm-field">
            <span>提示词</span>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述你要生成或编辑的图片..."
              className="min-h-[190px]"
            />
          </Label>

          <div className="xkm-form-grid">
            <Label className="xkm-field">
              <span>画幅</span>
              <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LANDSCAPE">16:9 横图</SelectItem>
                  <SelectItem value="PORTRAIT">9:16 竖图</SelectItem>
                  <SelectItem value="SQUARE">1:1 方图</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label className="xkm-field">
              <span>清晰度</span>
              <Select value={imageSize} onValueChange={(value) => setImageSize(value as ImageSize)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1K">1K 快速</SelectItem>
                  <SelectItem value="2K">2K 标准</SelectItem>
                  <SelectItem value="4K">4K 高质</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          </div>

          <div className="xkm-upload-grid">
            <Label className="xkm-upload-box">
              <Upload className="h-4 w-4" />
              <span>上传源图</span>
              <small>图生图使用，最多 1 张</small>
              <Input type="file" accept="image/*" className="hidden" onChange={(event) => handleSourceFiles(event.target.files)} />
            </Label>
            <Label className="xkm-upload-box">
              <Plus className="h-4 w-4" />
              <span>添加参考图</span>
              <small>最多保留 12 张</small>
              <Input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleReferenceFiles(event.target.files)} />
            </Label>
          </div>

          {(sourceFiles.length > 0 || referenceFiles.length > 0) && (
            <div className="xkm-reference-strip">
              {[...sourceFiles, ...referenceFiles].map((file) => (
                <div key={file.id} className="xkm-reference-thumb">
                  <img src={file.url} alt={file.label} />
                  <span>{file.label}</span>
                  <button
                    type="button"
                    aria-label={`移除${file.label}`}
                    onClick={() => {
                      if (sourceFiles.some((item) => item.id === file.id)) {
                        revokeLocalMediaFiles([file]);
                        setSourceFiles([]);
                      } else {
                        revokeLocalMediaFiles([file]);
                        setReferenceFiles((prev) => prev.filter((item) => item.id !== file.id));
                      }
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
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {running ? '生成中' : '生成图片'}
            </Button>
            <Button type="button" variant="outline" disabled={!running} onClick={() => abortRef.current?.abort()}>
              停止
            </Button>
            <Button type="button" variant="ghost" disabled={!resultUrl} onClick={clearResult}>
              <RotateCcw className="h-4 w-4" />
              清空结果
            </Button>
          </div>

          {(statusText || running) && (
            <div className="xkm-progress-block">
              <div><span>{statusText || '等待中'}</span></div>
              {resultBlob && <small>结果大小：{formatBytes(resultBlob.size)}</small>}
            </div>
          )}
        </section>

        <section className="xkm-media-preview">
          {resultUrl ? (
            <>
              <img src={resultUrl} alt="图片工作台生成结果" />
              <div className="xkm-preview-actions">
                <span>图片生成完成</span>
                <Button type="button" size="sm" onClick={() => downloadUrl(resultUrl, `xkm-image-${Date.now()}.png`)}>
                  <Download className="h-3.5 w-3.5" />
                  下载
                </Button>
              </div>
            </>
          ) : (
            <div className="xkm-empty-preview">
              <ImageIcon className="h-8 w-8" />
              <span>图片结果会显示在这里</span>
            </div>
          )}
        </section>
      </div>

      <section className="xkm-media-history">
        <div className="xkm-media-panel-head">
          <div>
            <h3>本机历史</h3>
            <p>记录最近 24 次生成。当前会话内的本地图片可直接回看，刷新后保留元信息。</p>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="xkm-history-empty">暂无图片历史</div>
        ) : (
          <div className="xkm-history-grid">
            {history.map((item) => (
              <button key={item.id} type="button" className="xkm-history-card" onClick={() => item.url && setResultUrl(item.url)} disabled={!item.url}>
                {item.url ? <img src={item.url} alt="" /> : <span>已刷新</span>}
                <strong>{item.model}</strong>
                <small>{item.imageSize} / {item.referenceCount} 张参考</small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
