import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  AlertCircle,
  ChevronDown,
  CheckCircle2,
  Download,
  Eye,
  FolderOpen,
  ImageIcon,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  Wand2,
} from '@/components/icons';
import type { Asset, ImageConcept, ImageSize } from '@/types';
import { useProject } from '@/stores/projectStore';
import {
  getSupportedImageSizesForConfig,
  normalizeImageSizeForConfig,
} from '@/lib/imageApiClient';
import {
  type AssetItem,
  type GenerationMode,
  formatAssetCreatedAt,
  getAssetVersionLabel,
  getSourceConcept,
} from './assetUtils';
import type { AssetPromptSourcePreview } from './assetPromptDerivation';
import { AssetPickerPanel } from './AssetPickerPanel';
import { SourcePreviewList } from './SourcePreviewList';
import {
  buildNoFacePreviewSource,
  isManualEnhancementSlot,
  isNoFaceCharacterVisualSlot,
  isOfficialVirtualHumanSlot,
  sanitizeNoFaceCharacterDescription,
} from './assetManagerRules';
import { useAssetThumbnail } from './useAssetThumbnail';

// ============================================================

export function EditPanel({
  item,
  assetLibrary,
  projectId,
  getConceptLabel,
  getConceptDesc,
  officialMode = false,
  showAssetPicker,
  onUpdateItem,
  onGenerate,
  onOptimize,
  onFileUpload,
  onReplaceImage,
  onSelectFromLibrary,
  onDownload,
  onDrop,
  onImageSizeChange,
  onReset,
  onSetDefault,
  descriptionPreview,
  contextPreview,
  sourcePreview,
  onPreview,
  onOpenVirtualHumanPicker,
  setShowAssetPicker,
}: {
  item: AssetItem;
  assetLibrary: Asset[];
  projectId?: string;
  getConceptLabel: (c: ImageConcept) => string;
  getConceptDesc: (c: ImageConcept) => string;
  officialMode?: boolean;
  showAssetPicker: boolean;
  onUpdateItem: (key: string, updates: Partial<AssetItem>) => void;
  onGenerate: (key: string) => void;
  onOptimize: (key?: string) => void;
  onFileUpload: (key: string, file: File) => void;
  onReplaceImage: (key: string, file: File) => void;
  onSelectFromLibrary: (key: string, asset: Asset) => void;
  onDownload: (key: string) => void;
  onDrop: (e: DragEvent, key: string) => void;
  onImageSizeChange: (key: string, size: ImageSize) => void;
  onReset: (key: string) => void;
  onSetDefault?: (key: string) => void;
  descriptionPreview: string;
  contextPreview?: string;
  sourcePreview: AssetPromptSourcePreview;
  onPreview: (url: string | null) => void;
  onOpenVirtualHumanPicker?: (key: string) => void;
  setShowAssetPicker: (v: boolean) => void;
}) {
  const { state } = useProject();
  const [imgHovering, setImgHovering] = useState(false);
  const [sourcePreviewExpanded, setSourcePreviewExpanded] = useState(false);
  const imageSizeOptions = getSupportedImageSizesForConfig(state.imageApiConfig);
  const activeImageSize = normalizeImageSizeForConfig(state.imageApiConfig, item.imageSize, imageSizeOptions[0] ?? '1K');
  const previewUrl = useAssetThumbnail(item.asset, item.localBlobUrl, projectId);
  const isOfficialIdentitySlot = isOfficialVirtualHumanSlot(item, officialMode);
  const isOfficialNoFaceVisual = isNoFaceCharacterVisualSlot(item, officialMode);
  const isOfficialAsset = item.asset?.source === 'volc_virtual_human';
  const shouldBlockFaceSource = isOfficialNoFaceVisual && getSourceConcept(item.concept) === 'portrait_closeup';
  const effectiveDescriptionPreview = isOfficialNoFaceVisual
    ? sanitizeNoFaceCharacterDescription(descriptionPreview)
    : descriptionPreview;
  const effectiveContextPreview = isOfficialNoFaceVisual ? undefined : contextPreview;
  const effectiveSourcePreview = isOfficialNoFaceVisual
    ? buildNoFacePreviewSource(item, descriptionPreview)
    : sourcePreview;
  const sourcePreviewTitle = isOfficialNoFaceVisual ? '无脸生成输入预览' : '描述来源预览';
  const sourcePreviewHint = isOfficialNoFaceVisual
    ? '官方库模式会过滤面部、发型、肤色和身份信息，默认生成只使用无脸服装模板。'
    : '默认生成会直接使用这里的基础描述；AI 润色只是在此基础上增强镜头感。';
  const descriptionHint = isOfficialNoFaceVisual
    ? '这是已过滤后的服装/体态目标，不直接使用含面部信息的 Step2 原文。'
    : '这是默认直接出图时使用的主描述。';
  const sourcePreviewCount =
    effectiveSourcePreview.descriptionSources.length
    + effectiveSourcePreview.contextSources.length
    + (effectiveDescriptionPreview ? 1 : 0)
    + (effectiveContextPreview ? 1 : 0);
  // #8 修复：局部 ref 替代全局 replaceFileInputRef
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const availableLibraryAssets = assetLibrary.filter((asset) => {
    if (asset.source === 'volc_virtual_human' && !isOfficialIdentitySlot) return false;
    if (asset.type !== item.type || asset.concept !== item.concept) return false;
    if (item.type === 'prop') {
      return (item.identityKey && asset.identityKey === item.identityKey)
        || (!asset.identityKey && asset.name === item.name);
    }
    if (item.type === 'character') {
      return asset.name === item.name
        && (item.variantKey ? asset.variantKey === item.variantKey : !asset.variantKey);
    }
    return asset.name === item.name;
  });
  const currentAssetVersionLabel = getAssetVersionLabel(item.asset, assetLibrary);
  const currentAssetCreatedAtLabel = formatAssetCreatedAt(item.asset);

  return (
    <div className="border-t bg-muted/20 px-4 py-4 space-y-4">
      {/* 标题 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{item.name}</span>
        {item.variantLabel && (
          <Badge variant="outline" className="text-xs rounded-full border-blue-200 text-blue-700 dark:text-blue-200">
            {item.variantLabel}
          </Badge>
        )}
        <Badge variant="outline" className="text-xs rounded-full">
          {getConceptLabel(item.concept)}
        </Badge>
        <Badge variant="outline" className="text-xs rounded-full">
          {item.aspectRatio === 'PORTRAIT' ? '📱 竖屏 9:16' : '🖥 横屏 16:9'}
        </Badge>
        {item.asset && (
          <Badge variant="outline" className="rounded-full border-slate-300 px-2 text-xs text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200">
            {currentAssetVersionLabel}{currentAssetCreatedAtLabel ? ` · ${currentAssetCreatedAtLabel}` : ''}
          </Badge>
        )}
        {isManualEnhancementSlot(item) && (
          <Badge variant="outline" className="text-xs rounded-full text-blue-600 border-blue-200">
            手动补充
          </Badge>
        )}
        <div className="ml-1 flex items-center gap-0.5 rounded-full border border-border/60 bg-background/70 p-1">
          {imageSizeOptions.map((size) => (
            <button
              key={size}
              onClick={(e) => { e.stopPropagation(); onImageSizeChange(item.key, size); }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                activeImageSize === size
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{getConceptDesc(item.concept)}</span>
      </div>

      {isOfficialIdentitySlot && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="h-6 rounded-full border-0 bg-blue-600 px-2.5 text-[10px] font-semibold text-white">
                  官方人像身份
                </Badge>
                {isOfficialAsset && (
                  <Badge variant="outline" className="rounded-full border-blue-300 px-2 text-[10px] text-blue-700 dark:border-blue-400/30 dark:text-blue-100">
                    {item.asset?.externalAssetId}
                  </Badge>
                )}
              </div>
              <p className="text-xs leading-5 text-blue-800 dark:text-blue-100">
                这里绑定官方定妆照；后续设定图和变装图只生成无脸服装/模特素材，不把官方脸带入图片生成链路。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                onOpenVirtualHumanPicker?.(item.key);
              }}
              className="h-9 shrink-0 rounded-xl border-blue-300 bg-background px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/10"
            >
              {isOfficialAsset ? '更换官方人像' : '匹配官方人像'}
            </Button>
          </div>
        </div>
      )}

      {!isOfficialIdentitySlot && (effectiveDescriptionPreview || effectiveContextPreview || effectiveSourcePreview.descriptionSources.length > 0 || effectiveSourcePreview.contextSources.length > 0) && (
        <div className="rounded-2xl border border-border/60 bg-background/65 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Badge className="h-6 rounded-full border-0 brand-gradient px-2.5 text-[10px] font-semibold text-white shadow-brand-sm">
                {sourcePreviewTitle}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {sourcePreviewHint}
              </span>
              <Badge variant="outline" className="rounded-full px-2 text-[10px] text-muted-foreground">
                {sourcePreviewCount} 项
              </Badge>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={sourcePreviewExpanded}
              onClick={() => setSourcePreviewExpanded((value) => !value)}
              className="h-8 gap-1 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sourcePreviewExpanded ? '' : '-rotate-90'}`} />
              {sourcePreviewExpanded ? '收起' : '展开'}
            </Button>
          </div>
          {sourcePreviewExpanded && (
            <>
              {effectiveDescriptionPreview && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full px-2 text-[10px]">
                      {isOfficialNoFaceVisual ? '无脸目标预览' : '基础描述预览'}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{descriptionHint}</span>
                  </div>
                  <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-5 text-foreground/90 [overflow-wrap:anywhere]">
                    {effectiveDescriptionPreview}
                  </div>
                </div>
              )}
              <SourcePreviewList
                title="基础描述来源"
                hint="优先展示 Step2 主描述和结构化字段。"
                entries={effectiveSourcePreview.descriptionSources}
              />
              <SourcePreviewList
                title="上下文补充来源"
                hint={isOfficialNoFaceVisual ? '这里显示官方库模式的无脸保护规则。' : '这些内容不会直接替代主描述，只用于补充一致性和镜头信息。'}
                entries={effectiveSourcePreview.contextSources}
              />
              {effectiveContextPreview && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full px-2 text-[10px]">
                      上下文预览
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">改编稿和原文命中会在这里汇总。</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                    {effectiveContextPreview}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 图生图提示 */}
      {isOfficialNoFaceVisual && (
        <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          <span>官方库模式下，此槽位会生成无脸服装/模特素材，不使用官方定妆照做图生图源图。</span>
        </div>
      )}
      {!isOfficialNoFaceVisual && item.type === 'character' && item.concept !== 'portrait_closeup' && !item.baseAssetId && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>需要先生成「{item.concept === 'landscape_outfit_turnaround' ? '变装定妆照' : '标准正面定妆照'}」作为源图，此图将基于它图生图以保持人物一致性</span>
        </div>
      )}
      {!isOfficialNoFaceVisual && item.type === 'character' && item.concept !== 'portrait_closeup' && item.baseAssetId && (
        <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          <span>已链接「{item.concept === 'landscape_outfit_turnaround' ? '变装定妆照' : '标准正面定妆照'}」作为源图，将以图生图方式保持人物一致性</span>
        </div>
      )}
      {item.type === 'scene' && (
        <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{item.concept === 'scene_vertical' ? '竖屏场景导演板会独立生成，供 9:16 视频直接调用；需要主环境图、高对比俯视走位、放大机位、固定图例和空间锚点对应，不需要横屏图作为源图。' : '横屏场景导演板会独立生成，供 16:9 视频直接调用；需要主环境图、高对比俯视走位、放大机位、固定图例和空间锚点对应，竖屏版本会单独锁定同一地点。'}</span>
        </div>
      )}

      {/* 图片预览 */}
      <div className="flex justify-center">
        {item.asset ? (
          previewUrl ? (
            <div
              className="relative"
              onMouseEnter={() => setImgHovering(true)}
              onMouseLeave={() => setImgHovering(false)}
              onDragOver={(e) => { if (!isOfficialAsset) e.preventDefault(); }}
              onDrop={(e) => { if (!isOfficialAsset) onDrop(e, item.key); }}
            >
              <img
                src={previewUrl}
                alt={item.name}
                className={`rounded-lg border max-h-48 object-contain bg-muted ${
                  item.aspectRatio === 'LANDSCAPE' ? 'max-w-md' : 'max-w-[180px]'
                }`}
              />
              {imgHovering && (
                <div className="absolute inset-0 flex items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary/10">
                  <button
                    className="flex flex-col items-center gap-0.5 p-2 rounded-lg hover:bg-primary/20 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(previewUrl);
                    }}
                  >
                    <Eye className="h-5 w-5 text-primary" />
                    <span className="text-[10px] font-medium text-primary">放大</span>
                  </button>
                  {!isOfficialAsset && (
                    <button
                      className="flex flex-col items-center gap-0.5 p-2 rounded-lg hover:bg-primary/20 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); replaceFileInputRef.current?.click(); }}
                    >
                      <Upload className="h-5 w-5 text-primary" />
                      <span className="text-[10px] font-medium text-primary">替换</span>
                    </button>
                  )}
                </div>
              )}
              {!isOfficialAsset && (
                <input
                  ref={replaceFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onReplaceImage(item.key, file);
                    e.target.value = '';
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">正在加载预览...</span>
            </div>
          )
        ) : item.isProcessing ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">生成中...</span>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-2 py-4 text-muted-foreground"
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => onDrop(e, item.key)}
          >
            <ImageIcon className="h-8 w-8 opacity-30" />
            <span className="text-xs">暂无图片（可拖拽上传）</span>
          </div>
        )}
      </div>

      {item.asset && (
        <div className="rounded-2xl border border-rose-300/70 bg-rose-50/85 p-3 shadow-sm dark:border-rose-400/35 dark:bg-rose-500/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-rose-800 dark:text-rose-100">对当前图不满意？</div>
              <div className="mt-0.5 text-[11px] leading-5 text-rose-700/85 dark:text-rose-100/75">
                重置会清空当前槽位绑定，让你重新生成或重新上传；资产库原图不会被删除。
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onReset(item.key); }}
              disabled={item.isProcessing}
              className="h-8 shrink-0 gap-1 rounded-xl border-rose-400 bg-white px-3 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-500/15"
            >
              <Trash2 className="h-3.5 w-3.5" />重置当前图
            </Button>
          </div>
        </div>
      )}

      {/* Prompt 编辑 */}
      {!isOfficialIdentitySlot && (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">图片 Prompt 覆盖</Label>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onOptimize(item.key); }}
            disabled={item.isProcessing}
            className="h-6 text-[10px] gap-1"
          >
            <Wand2 className="h-3 w-3" />{isOfficialNoFaceVisual ? '套用无脸模板' : 'AI 润色'}
          </Button>
        </div>
        <textarea
          value={item.optimizedPrompt}
          onChange={(e) => onUpdateItem(item.key, { optimizedPrompt: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder={isOfficialNoFaceVisual
            ? '留空则使用官方库无脸服装模板；手动覆盖时也请保持无脸/无头、不要写五官或可识别身份...'
            : '留空则直接使用 Step2 基础描述自动装配 prompt；也可以在这里手动覆盖或点 AI 润色...'}
          className="w-full min-h-[60px] text-xs px-3 py-2 rounded-md border border-input bg-background resize-y"
        />
        <p className="text-[11px] leading-5 text-muted-foreground">
          {item.optimizedPrompt.trim() === ''
            ? (isOfficialNoFaceVisual
                ? '当前未覆盖时，点击“生成图片”会使用无脸服装模板自动出图。'
                : '当前未覆盖时，点击“生成图片”会直接使用基础描述自动出图。')
            : '当前将优先使用这里的覆盖 prompt 生成图片。'}
        </p>
      </div>
      )}

      {/* 生成模式 */}
      {!isOfficialIdentitySlot && (
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">生成方式</Label>
        <div className="flex gap-1.5 flex-wrap">
          {([
            { mode: 'upload' as GenerationMode, label: '📤 上传' },
            { mode: 'txt2img' as GenerationMode, label: '✨ 文生图' },
            { mode: 'img2img' as GenerationMode, label: '🖼 图生图' },
          ]).filter(({ mode }) => !(shouldBlockFaceSource && mode === 'img2img')).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={(e) => { e.stopPropagation(); onUpdateItem(item.key, { generationMode: mode }); setShowAssetPicker(false); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[10px] transition-colors ${
                item.generationMode === mode && !showAssetPicker
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
          {availableLibraryAssets.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowAssetPicker(!showAssetPicker); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[10px] transition-colors ${
                showAssetPicker ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
              }`}
            >
              <FolderOpen className="h-3 w-3" />📁 资产库
            </button>
          )}
        </div>
      </div>
      )}

      {/* 图生图源图选择 */}
      {!isOfficialIdentitySlot && item.generationMode === 'img2img' && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">参考图片</Label>
          <select
            value={item.baseAssetId ?? ''}
            onChange={(e) => { onUpdateItem(item.key, { baseAssetId: e.target.value || undefined }); }}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs px-2 py-1.5 rounded-md border border-input bg-background"
          >
            <option value="">— 选择参考图 —</option>
            {assetLibrary
              .filter((a) => a.type === item.type && a.name === item.name && a.id !== item.asset?.id && a.source !== 'volc_virtual_human')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} - {getConceptLabel(a.concept)} - {getAssetVersionLabel(a, assetLibrary)}{formatAssetCreatedAt(a) ? ` - ${formatAssetCreatedAt(a)}` : ''}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* 资产库选择面板 */}
      {!isOfficialIdentitySlot && showAssetPicker && (
          <AssetPickerPanel
            assets={availableLibraryAssets}
            projectId={projectId}
            currentAssetId={item.asset?.id}
            onSelect={(asset) => onSelectFromLibrary(item.key, asset)}
            onCancel={() => setShowAssetPicker(false)}
            getConceptLabel={getConceptLabel}
        />
      )}

      {/* 上传文件 */}
      {!isOfficialIdentitySlot && item.generationMode === 'upload' && !item.asset && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">选择本地图片</Label>
          <input
            type="file"
            accept="image/*"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload(item.key, file);
            }}
            className="w-full text-xs file:mr-2 file:py-0.5 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-muted file:hover:bg-muted/80 cursor-pointer"
          />
        </div>
      )}

      {/* 错误提示 - #12 新增重试按钮 */}
      {item.error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 rounded px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">{item.error}</span>
          {!isOfficialIdentitySlot && item.generationMode !== 'upload' && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onGenerate(item.key); }}
              disabled={item.isProcessing}
              className="h-5 text-[10px] gap-1 shrink-0 border-red-300 text-red-600 hover:bg-red-50"
            >
              <RotateCcw className="h-3 w-3" />重试
            </Button>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-1.5 flex-wrap">
        {!isOfficialIdentitySlot && item.generationMode !== 'upload' && (
          <Button
            size="sm"
            onClick={(e) => { e.stopPropagation(); onGenerate(item.key); }}
            disabled={item.isProcessing}
            className="h-7 text-xs gap-1"
          >
            {item.isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            {item.asset ? '重新生成' : '生成图片'}
          </Button>
        )}
        {item.asset && (
          <>
            {/* #2 修复：放大按钮连接到全屏预览 */}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(previewUrl);
              }}
              disabled={!previewUrl}
              className="h-7 text-xs gap-1"
            >
              <Eye className="h-3 w-3" />放大
            </Button>
            {!isOfficialAsset && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); onDownload(item.key); }}
                className="h-7 text-xs gap-1"
              >
                <Download className="h-3 w-3" />下载
              </Button>
            )}
            {/* 设为默认：仅角色类型显示 */}
            {item.type === 'character' && item.concept === 'portrait_closeup' && onSetDefault && (
              item.asset?.isDefault ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onSetDefault(item.key); }}
                  className="h-7 text-xs gap-1 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                >
                  ⭐ 取消默认
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onSetDefault(item.key); }}
                  className="h-7 text-xs gap-1 border-amber-300 text-amber-600 hover:bg-amber-50"
                >
                  ⭐ 设为默认
                </Button>
              )
            )}
            {/* #6 + #11 修复：重置时删除 Asset 并增加确认弹窗 */}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onReset(item.key); }}
              disabled={item.isProcessing}
              className="h-7 gap-1 border-rose-300 px-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-400/40 dark:text-rose-200 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-3 w-3" />重置此图
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
