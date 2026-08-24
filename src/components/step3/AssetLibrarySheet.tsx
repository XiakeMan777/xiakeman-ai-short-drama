// ============================================================
// 全局资产库抽屉 - 从 Sidebar 触发，展示项目所有资产
// ============================================================

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ImageIcon,
  Download,
  CheckCircle2,
  Loader2,
  Upload,
  Search,
  Trash2,
} from '@/components/icons';
import { useCurrentProject } from '@/stores/projectStore';
import { deleteBlob, deleteBlobs, loadBlob, saveBlob } from '@/lib/imageStore';
import type { Asset, ImageConcept } from '@/types';
import {
  buildAssetDownloadFileName,
  formatAssetCreatedAt,
  getAssetVariantLabel,
  getAssetVersionLabel,
} from './assetUtils';
import {
  CHARACTER_IMAGE_CONCEPTS as CHAR_CONCEPTS,
  SCENE_IMAGE_CONCEPTS as SCENE_CONCEPTS,
  PROP_IMAGE_CONCEPT as PROP_CONCEPT,
} from '@/types';

interface AssetLibrarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterType = 'all' | 'character' | 'scene' | 'prop';

const DEFAULT_SHEET_WIDTH = 520;
const MIN_SHEET_WIDTH = 420;
const MAX_SHEET_WIDTH_RATIO = 0.85;
const MIN_CARD_WIDTH = 170;
const MAX_GRID_COLUMNS = 6;
const EMPTY_ASSET_LIBRARY: Asset[] = [];

function clearLightweightVariantFields(): Partial<Asset> {
  return {
    lightweightBlobKey: undefined,
    lightweightMimeType: undefined,
    lightweightQuality: undefined,
    lightweightOriginalBytes: undefined,
    lightweightBytes: undefined,
    lightweightWidth: undefined,
    lightweightHeight: undefined,
    lightweightCreatedAt: undefined,
  };
}

function getConceptLabel(concept?: ImageConcept): string {
  if (!concept) return '未分类';
  const sceneConcept = SCENE_CONCEPTS.find((item) => item.concept === concept);
  if (sceneConcept) return sceneConcept.label;
  if (concept === 'prop_main') return PROP_CONCEPT.label;
  return CHAR_CONCEPTS.find((c) => c.concept === concept)?.label ?? concept;
}

export function AssetLibrarySheet({ open, onOpenChange }: AssetLibrarySheetProps) {
  const { dispatch, currentProject } = useCurrentProject();
  const assetLibrary = currentProject?.assetLibrary ?? EMPTY_ASSET_LIBRARY;

  const [filter, setFilter] = useState<FilterType>('all');
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);
  const [sheetWidth, setSheetWidth] = useState(DEFAULT_SHEET_WIDTH);
  const previewUrlRef = useRef<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_SHEET_WIDTH);

  const clearPreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setLoadingPreview(false);
  }, []);

  const handleSelectPreviewAsset = useCallback((asset: Asset) => {
    clearPreviewUrl();
    const canUseDirectPreview = !!asset.thumbnailUrl || asset.source === 'volc_virtual_human';
    setPreviewUrl(asset.thumbnailUrl ?? null);
    setLoadingPreview(!canUseDirectPreview);
    setPreviewAsset(asset);
  }, [clearPreviewUrl]);

  const clampSheetWidth = useCallback((width: number) => {
    if (typeof window === 'undefined') return width;
    const maxWidth = Math.max(MIN_SHEET_WIDTH, Math.floor(window.innerWidth * MAX_SHEET_WIDTH_RATIO));
    return Math.min(Math.max(width, MIN_SHEET_WIDTH), maxWidth);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePointerMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartXRef.current - event.clientX;
      setSheetWidth(clampSheetWidth(resizeStartWidthRef.current + delta));
    };

    const stopResizing = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleWindowResize = () => {
      setSheetWidth((prev) => clampSheetWidth(prev));
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('resize', handleWindowResize);
      stopResizing();
    };
  }, [clampSheetWidth]);

  const startResizing = (event: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window === 'undefined') return;
    isResizingRef.current = true;
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = sheetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const referencedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chapter of currentProject?.chapters ?? []) {
      for (const storyboard of chapter.storyboards ?? []) {
        for (const imageRef of storyboard.imageRefs ?? []) {
          if (imageRef.assetId) ids.add(imageRef.assetId);
        }
      }
    }
    return ids;
  }, [currentProject?.chapters]);

  const directReferenceCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chapter of currentProject?.chapters ?? []) {
      for (const storyboard of chapter.storyboards ?? []) {
        for (const imageRef of storyboard.imageRefs ?? []) {
          if (!imageRef.assetId) continue;
          counts.set(imageRef.assetId, (counts.get(imageRef.assetId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [currentProject?.chapters]);

  const baseReferencedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const asset of assetLibrary) {
      if (asset.baseAssetId) ids.add(asset.baseAssetId);
    }
    return ids;
  }, [assetLibrary]);

  const baseDependentCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assetLibrary) {
      if (!asset.baseAssetId) continue;
      counts.set(asset.baseAssetId, (counts.get(asset.baseAssetId) ?? 0) + 1);
    }
    return counts;
  }, [assetLibrary]);

  const getBaseDependentCount = useCallback((assetId: string) => {
    return baseDependentCountMap.get(assetId) ?? 0;
  }, [baseDependentCountMap]);

  const getDirectReferenceCount = useCallback((assetId: string) => {
    return directReferenceCountMap.get(assetId) ?? 0;
  }, [directReferenceCountMap]);

  const isAssetUnused = (asset: Asset) => {
    return !referencedAssetIds.has(asset.id)
      && !baseReferencedAssetIds.has(asset.id)
      && (asset.usedInStoryboards?.length ?? 0) === 0;
  };

  const assetGridColumns = useMemo(() => {
    const usableWidth = Math.max(sheetWidth - 48, MIN_CARD_WIDTH * 2);
    return Math.min(
      MAX_GRID_COLUMNS,
      Math.max(2, Math.floor(usableWidth / MIN_CARD_WIDTH)),
    );
  }, [sheetWidth]);

  // 筛选资产
  const filteredAssets = assetLibrary.filter((asset) => {
    if (filter !== 'all' && asset.type !== filter) return false;
    if (showUnusedOnly && !isAssetUnused(asset)) return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    return asset.name.toLowerCase().includes(query)
      || getConceptLabel(asset.concept).toLowerCase().includes(query)
      || getAssetVersionLabel(asset, assetLibrary).toLowerCase().includes(query)
      || getAssetVariantLabel(asset).toLowerCase().includes(query)
      || formatAssetCreatedAt(asset).toLowerCase().includes(query)
      || (asset.identityKey ?? '').toLowerCase().includes(query);
  }).slice().sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));

  // 加载预览图
  useEffect(() => {
    if (!previewAsset) return;
    if (previewAsset.thumbnailUrl || previewAsset.source === 'volc_virtual_human') {
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;

    loadBlob(previewAsset.blobKey).then((blob) => {
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      }
      setLoadingPreview(false);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewAsset]);

  // 下载资产
  const handleDownload = async (asset: Asset) => {
    if (asset.source === 'volc_virtual_human') return;
    const blob = await loadBlob(asset.blobKey);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildAssetDownloadFileName(asset, assetLibrary, getConceptLabel);
    a.click();
    URL.revokeObjectURL(url);
  };

  // 替换资产图片（保持 Asset ID 不变）
  const replaceAssetImage = async (asset: Asset, file: File) => {
    if (asset.source === 'volc_virtual_human') return;
    const previousBlobKey = asset.blobKey;
    const previousLightweightBlobKey = asset.lightweightBlobKey;
    const newBlobKey = await saveBlob(file);
    dispatch({
      type: 'UPDATE_ASSET',
      assetId: asset.id,
      updates: { blobKey: newBlobKey, ...clearLightweightVariantFields(), updatedAt: Date.now() },
    });
    // 更新预览
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const newBlob = await loadBlob(newBlobKey);
    if (newBlob) {
      const url = URL.createObjectURL(newBlob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
    if (!previousBlobKey.startsWith('external:')) {
      await deleteBlob(previousBlobKey).catch(() => undefined);
    }
    if (previousLightweightBlobKey) {
      await deleteBlob(previousLightweightBlobKey).catch(() => undefined);
    }
  };

  const characterCount = assetLibrary.filter((a) => a.type === 'character').length;
  const sceneCount = assetLibrary.filter((a) => a.type === 'scene').length;
  const propCount = assetLibrary.filter((a) => a.type === 'prop').length;
  const unusedCount = assetLibrary.filter((asset) => isAssetUnused(asset)).length;

  const handleDeleteAsset = (asset: Asset) => {
    const isUnused = isAssetUnused(asset);
    const dependentCount = getBaseDependentCount(asset.id);
    const message = isUnused
      ? dependentCount > 0
        ? `资产「${asset.name}」当前仍被 ${dependentCount} 个图生图资产作为源图引用。删除后会解除这些源图关联，确定继续吗？`
        : `确定删除资产「${asset.name}」吗？`
      : `资产「${asset.name}」仍有关联引用${dependentCount > 0 ? `，并且被 ${dependentCount} 个图生图资产作为源图使用` : ''}。删除后会清空相关分镜绑定${dependentCount > 0 ? '并解除源图关联' : ''}。确定继续吗？`;
    if (!window.confirm(message)) return;
    if (previewAsset?.id === asset.id) {
      setPreviewAsset(null);
      clearPreviewUrl();
    }
    dispatch({ type: 'DELETE_ASSET', assetId: asset.id });
    if (asset.source !== 'volc_virtual_human' && !asset.blobKey.startsWith('external:')) {
      deleteBlob(asset.blobKey).catch(() => undefined);
    }
    if (asset.lightweightBlobKey) {
      deleteBlob(asset.lightweightBlobKey).catch(() => undefined);
    }
  };

  const handleCleanupUnused = () => {
    const unusedAssets = assetLibrary.filter((asset) => isAssetUnused(asset));
    if (unusedAssets.length === 0) return;
    if (!window.confirm(`确定清理 ${unusedAssets.length} 个未使用资产吗？此操作不可撤销。`)) return;
    if (previewAsset && unusedAssets.some((asset) => asset.id === previewAsset.id)) {
      setPreviewAsset(null);
      clearPreviewUrl();
    }
    unusedAssets.forEach((asset) => {
      dispatch({ type: 'DELETE_ASSET', assetId: asset.id });
    });
    deleteBlobs(
      unusedAssets
        .filter((asset) => asset.source !== 'volc_virtual_human' && !asset.blobKey.startsWith('external:'))
        .flatMap((asset) => [
          asset.blobKey,
          ...(asset.lightweightBlobKey ? [asset.lightweightBlobKey] : []),
        ]),
    ).catch(() => undefined);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[92vw] sm:max-w-none flex flex-col"
        style={{ width: `${sheetWidth}px`, maxWidth: `${Math.floor((typeof window !== 'undefined' ? window.innerWidth : 1600) * MAX_SHEET_WIDTH_RATIO)}px` }}
      >
        <div
          className="absolute inset-y-0 left-0 z-20 hidden sm:block w-2 cursor-col-resize bg-transparent"
          onMouseDown={startResizing}
          aria-label="调整资产库宽度"
        >
          <div className="absolute inset-y-0 left-0 w-px bg-border/80" />
        </div>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>📁</span> 全局资产库
          </SheetTitle>
          <SheetDescription>
            当前项目共有 {assetLibrary.length} 个资产（{characterCount} 个角色，{sceneCount} 个场景，{propCount} 个道具）
          </SheetDescription>
        </SheetHeader>

        {assetLibrary.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <ImageIcon className="h-16 w-16 opacity-20 mb-4" />
            <p className="text-sm">暂无资产</p>
            <p className="text-xs mt-1">在 Step 3 生成或上传图片后即可在此查看</p>
          </div>
        ) : (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)} className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索名称 / 概念 / 身份键"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  variant={showUnusedOnly ? 'default' : 'outline'}
                  onClick={() => setShowUnusedOnly((prev) => !prev)}
                  className="h-8 text-xs"
                >
                  仅未使用
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>未使用资产 {unusedCount} 个</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCleanupUnused}
                  disabled={unusedCount === 0}
                  className="h-7 text-xs gap-1"
                >
                  <Trash2 className="h-3 w-3" />清理未使用
                </Button>
              </div>
            </div>
            <TabsList className="mx-4 mt-2">
              <TabsTrigger value="all">全部 ({assetLibrary.length})</TabsTrigger>
              <TabsTrigger value="character">角色 ({characterCount})</TabsTrigger>
              <TabsTrigger value="scene">场景 ({sceneCount})</TabsTrigger>
              <TabsTrigger value="prop">道具 ({propCount})</TabsTrigger>
            </TabsList>

            <TabsContent value={filter} className="flex-1 overflow-y-auto px-4 pb-4 mt-2">
              {filteredAssets.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <p className="text-sm">该分类下暂无资产</p>
                </div>
              ) : (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${assetGridColumns}, minmax(0, 1fr))` }}
                >
                  {filteredAssets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      assetLibrary={assetLibrary}
                      isUnused={isAssetUnused(asset)}
                      isSelected={previewAsset?.id === asset.id}
                      directReferenceCount={getDirectReferenceCount(asset.id)}
                      baseDependentCount={getBaseDependentCount(asset.id)}
                      onClick={() => handleSelectPreviewAsset(asset)}
                      onDownload={() => handleDownload(asset)}
                      onDelete={() => handleDeleteAsset(asset)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* 预览区 */}
        {previewAsset && (
          <div className="border-t p-4 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span>{previewAsset.type === 'character' ? '👤' : previewAsset.type === 'scene' ? '📍' : '🎒'}</span>
                <span className="font-medium text-sm">{previewAsset.name}</span>
                <Badge variant="outline" className="text-xs">
                  {getAssetVersionLabel(previewAsset, assetLibrary)}
                </Badge>
                {getAssetVariantLabel(previewAsset) && (
                  <Badge variant="outline" className="text-xs">
                    {getAssetVariantLabel(previewAsset)}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {getConceptLabel(previewAsset.concept)}
                </Badge>
                {formatAssetCreatedAt(previewAsset) && (
                  <Badge variant="outline" className="text-xs">
                    {formatAssetCreatedAt(previewAsset)}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {previewAsset.generationMode === 'upload' ? '上传' : previewAsset.generationMode === 'txt2img' ? '文生图' : '图生图'}
                </Badge>
                {previewAsset.source === 'volc_virtual_human' && (
                  <Badge className="border-0 bg-blue-600 text-xs text-white">官方人像</Badge>
                )}
                {previewAsset.isDefault && previewAsset.type === 'character' && (
                  <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-300">⭐ 默认</Badge>
                )}
                {isAssetUnused(previewAsset) && (
                  <Badge variant="secondary" className="text-xs">未使用</Badge>
                )}
                {getBaseDependentCount(previewAsset.id) > 0 && (
                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">
                    作为源图 {getBaseDependentCount(previewAsset.id)} 次
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {previewAsset.source !== 'volc_virtual_human' && (
                  <Button size="sm" variant="ghost" onClick={() => handleDownload(previewAsset)} className="gap-1 h-7">
                    <Download className="h-3 w-3" />
                    下载
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => handleDeleteAsset(previewAsset)} className="gap-1 h-7 text-red-600">
                  <Trash2 className="h-3 w-3" />
                  删除
                </Button>
              </div>
            </div>
            {loadingPreview ? (
              <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : previewUrl ? (
              <div className="relative">
                <img
                  src={previewUrl}
                  alt={previewAsset.name}
                  className="w-full h-48 object-contain bg-muted rounded-lg"
                />
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    分镜引用 {getDirectReferenceCount(previewAsset.id)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    槽位占用 {previewAsset.usedInStoryboards?.length ?? 0}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    源图依赖 {getBaseDependentCount(previewAsset.id)}
                  </Badge>
                </div>
                {previewAsset.source !== 'volc_virtual_human' && (
                  <>
                    {/* 替换按钮 */}
                    <button
                      className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-background/90 border rounded text-xs text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                      onClick={() => replaceFileInputRef.current?.click()}
                    >
                      <Upload className="h-3 w-3" />
                      替换
                    </button>
                    {/* 隐藏的文件输入 */}
                    <input
                      ref={replaceFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && previewAsset) replaceAssetImage(previewAsset, file);
                        e.target.value = '';
                      }}
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 bg-muted rounded-lg text-muted-foreground text-sm">
                无法加载预览
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// 资产卡片组件
function AssetCard({
  asset,
  assetLibrary,
  isUnused,
  isSelected,
  directReferenceCount,
  baseDependentCount,
  onClick,
  onDownload,
  onDelete,
}: {
  asset: Asset;
  assetLibrary: Asset[];
  isUnused: boolean;
  isSelected: boolean;
  directReferenceCount: number;
  baseDependentCount: number;
  onClick: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const thumbUrlRef = useRef<string | null>(null);
  const displayThumbUrl = asset.thumbnailUrl ?? thumbUrl;
  const displayLoading = asset.thumbnailUrl ? false : loading;
  const versionLabel = getAssetVersionLabel(asset, assetLibrary);
  const variantLabel = getAssetVariantLabel(asset);
  const createdAtLabel = formatAssetCreatedAt(asset);

  useEffect(() => {
    if (asset.thumbnailUrl) {
      return;
    }
    let cancelled = false;
    loadBlob(asset.blobKey).then((blob) => {
      if (blob && !cancelled) {
        const url = URL.createObjectURL(blob);
        thumbUrlRef.current = url;
        setThumbUrl(url);
      }
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    };
  }, [asset.blobKey, asset.thumbnailUrl]);

  return (
    <div
      className={`relative rounded-lg border overflow-hidden cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-primary' : 'hover:border-primary/50'
      }`}
      onClick={onClick}
    >
      {/* 缩略图 */}
      <div className={`${asset.aspectRatio === 'PORTRAIT' ? 'aspect-[3/4]' : 'aspect-video'} bg-muted flex items-center justify-center`}>
        {displayLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : displayThumbUrl ? (
          <img src={displayThumbUrl} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-2 bg-background">
        <div className="flex items-center gap-1">
          <span className="text-xs">{asset.type === 'character' ? '👤' : asset.type === 'scene' ? '📍' : '🎒'}</span>
          <span className="text-xs font-medium truncate flex-1">{asset.name}</span>
          <span className="text-[9px] text-muted-foreground">{getConceptLabel(asset.concept)}</span>
          <Badge variant="outline" className="h-4 px-1 text-[8px]">{versionLabel}</Badge>
          {asset.source === 'volc_virtual_human' && <Badge className="h-4 border-0 bg-blue-600 px-1 text-[8px] text-white">官方</Badge>}
          {asset.isDefault && asset.type === 'character' && <Badge className="h-4 px-1 text-[8px] bg-amber-100 text-amber-700 border-amber-300">⭐默认</Badge>}
          {isUnused && <Badge variant="secondary" className="h-4 px-1 text-[8px]">未使用</Badge>}
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {variantLabel && (
            <Badge variant="outline" className="h-4 px-1 text-[8px] text-blue-600 border-blue-200">
              {variantLabel}
            </Badge>
          )}
          {createdAtLabel && (
            <Badge variant="outline" className="h-4 px-1 text-[8px] text-muted-foreground">
              {createdAtLabel}
            </Badge>
          )}
          {directReferenceCount > 0 && (
            <Badge variant="outline" className="h-4 px-1 text-[8px] text-muted-foreground">
              分镜 {directReferenceCount}
            </Badge>
          )}
          {baseDependentCount > 0 && (
            <Badge variant="outline" className="h-4 px-1 text-[8px] text-blue-600 border-blue-200">
              源图 {baseDependentCount}
            </Badge>
          )}
        </div>
      </div>

      <div className="absolute top-1 right-1 flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`删除资产 ${asset.name}`}
          title={`删除资产 ${asset.name}`}
          className="p-1 bg-background/80 rounded hover:bg-background text-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        {asset.source !== 'volc_virtual_human' && (
          <button
            onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          aria-label={`下载资产 ${asset.name}`}
          title={`下载资产 ${asset.name}`}
          className="p-1 bg-background/80 rounded hover:bg-background"
        >
          <Download className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
