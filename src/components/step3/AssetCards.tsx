import { type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, CheckCircle2 } from '@/components/icons';
import type {
  Asset,
  ImageConcept,
  ImageReference,
  ImageSize,
  PropConsistency,
} from '@/types';
import {
  CHARACTER_IMAGE_CONCEPTS as CHAR_CONCEPTS,
  PROP_IMAGE_CONCEPT as PROP_CONCEPT,
} from '@/types';
import { getSafePropHolderLabel } from '@/lib/characterAssetGuards';
import { getGroupCharacterConceptMeta, isGroupCharacterName } from '@/lib/groupCharacterAssets';
import type { AssetItem } from './assetUtils';
import type { AssetPromptSourcePreview } from './assetPromptDerivation';
import { EditPanel } from './EditPanel';
import { ImageSlot } from './ImageSlot';
import {
  CORE_CHARACTER_CONCEPTS,
  getCharacterItemsForName,
  getCharacterSlotWidthClass,
  getSceneConceptMeta,
  hasMissingDependency,
  isManualEnhancementSlot,
  sortCharacterItems,
} from './assetManagerRules';

// ============================================================

export function CharacterCard({
  ir,
  items,
  stat,
  allDone,
  editingKey,
  onThumbClick,
  onPreview,
  assetLibrary,
  projectId,
  getConceptLabel,
  getConceptDesc,
  officialMode,
  editing,
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
  buildDescription,
  buildContext,
  buildSourcePreview,
  onOpenVirtualHumanPicker,
  setShowAssetPicker,
}: {
  ir: ImageReference;
  items: Record<string, AssetItem>;
  stat: {
    ready: number;
    total: number;
    coreReady: number;
    coreTotal: number;
    enhancementReady: number;
    enhancementTotal: number;
    hasDefault?: boolean;
    defaultConcept?: string;
  };
  allDone: boolean;
  editingKey: string | null;
  onThumbClick: (key: string) => void;
  onPreview: (url: string | null) => void;
  assetLibrary: Asset[];
  projectId?: string;
  getConceptLabel: (c: ImageConcept) => string;
  getConceptDesc: (c: ImageConcept) => string;
  officialMode: boolean;
  editing: AssetItem | null;
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
  onSetDefault: (key: string) => void;
  buildDescription: (item: AssetItem) => string;
  buildContext: (item: AssetItem) => string | undefined;
  buildSourcePreview: (item: AssetItem) => AssetPromptSourcePreview;
  onOpenVirtualHumanPicker: (key: string) => void;
  setShowAssetPicker: (v: boolean) => void;
}) {
  const isGroupCharacter = isGroupCharacterName(ir.name);
  const cardItems = getCharacterItemsForName(items, ir.name);
  const coreItems = cardItems.filter((item) => CORE_CHARACTER_CONCEPTS.includes(item.concept));
  const officialIdentityItem = coreItems.find((item) => item.concept === 'portrait_closeup');
  const outfitGroups = cardItems
    .filter((item) => isManualEnhancementSlot(item) && !!item.variantKey)
    .reduce<Array<{ key: string; label: string; items: AssetItem[] }>>((groups, item) => {
      const groupKey = item.variantKey ?? item.key;
      const existing = groups.find((group) => group.key === groupKey);
      if (existing) {
        existing.items.push(item);
        existing.items = sortCharacterItems(existing.items);
      } else {
        groups.push({
          key: groupKey,
          label: item.variantLabel ?? `变装 ${item.outfitSeq ?? ''}`.trim(),
          items: [item],
        });
      }
      return groups;
    }, []);
  const hasDependencyIssue = cardItems.some((item) => hasMissingDependency(item, items, officialMode));
  const hasFailure = cardItems.some((item) => !!item.error);
  const needsManual = stat.enhancementTotal > 0 && stat.enhancementReady < stat.enhancementTotal;
  const coreGroupLabel = isGroupCharacter ? '群像基础图' : '基础角色图';
  const coreGroupDescription = isGroupCharacter
    ? '群像基础图和群像设定图集中在这里，先保证多人同框、阵营服装和集体站位稳定。'
    : '默认图和基础源图集中在这里，先保证角色识别稳定。';
  const autoReferenceLabel = coreItems.some((item) => item.concept === 'landscape_turnaround' && item.asset)
    ? '设定图优先'
    : coreItems.some((item) => item.concept === 'portrait_closeup' && item.asset)
      ? '标准定妆照兜底'
      : null;

  return (
    <Card className="step3-asset-card step3-character-card overflow-hidden rounded-[24px] border-border/60 bg-card/75 shadow-card">
      <div className="step3-asset-card-header border-b border-border/60 bg-gradient-to-r from-brand-orange/8 via-background/80 to-background/80 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">👤</span>
              <span className="truncate text-sm font-semibold">{ir.name}</span>
              {isGroupCharacter && (
                <Badge variant="outline" className="h-5 rounded-full border-brand-orange/30 px-2 text-[10px] text-brand-orange">
                  群像
                </Badge>
              )}
              {allDone ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>基础 {stat.coreReady}/{stat.coreTotal}</span>
              {stat.enhancementTotal > 0 && <span>扩展 {stat.enhancementReady}/{stat.enhancementTotal}</span>}
              {stat.hasDefault ? (
                <Badge className="h-5 rounded-full border-amber-300 bg-amber-100 px-2 text-[10px] text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200">
                  手动默认：{getConceptLabel(stat.defaultConcept as ImageConcept)}
                </Badge>
              ) : autoReferenceLabel ? (
                <Badge variant="outline" className="h-5 rounded-full border-amber-300 px-2 text-[10px] text-amber-600 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
                  自动引用：{autoReferenceLabel}
                </Badge>
              ) : null}
              {hasFailure && (
                <Badge variant="outline" className="h-5 rounded-full border-red-300 px-2 text-[10px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  失败
                </Badge>
              )}
              {hasDependencyIssue && (
                <Badge variant="outline" className="h-5 rounded-full border-blue-300 px-2 text-[10px] text-blue-600 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-200">
                  缺源图
                </Badge>
              )}
              {needsManual && (
                <Badge variant="outline" className="h-5 rounded-full border-slate-300 px-2 text-[10px] text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200">
                  待补手动素材
                </Badge>
              )}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
            <div className="w-full max-w-[180px] space-y-1 lg:w-[180px]">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>基础完成度</span>
                <span className="font-medium text-foreground">{stat.coreReady}/{stat.coreTotal}</span>
              </div>
              <Progress value={stat.coreTotal > 0 ? (stat.coreReady / stat.coreTotal) * 100 : 0} className="h-2" />
            </div>
            {officialMode && officialIdentityItem && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenVirtualHumanPicker(officialIdentityItem.key)}
                className="h-8 rounded-xl border-blue-300 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100"
              >
                {officialIdentityItem.asset?.source === 'volc_virtual_human' ? '更换官方人像' : '匹配官方人像'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 4个缩略图并排 */}
      <div className="step3-asset-card-body px-3 pb-3 pt-3">
        <div className="step3-slot-scroll overflow-x-auto pb-1">
          <div className="step3-slot-row flex min-w-max items-start gap-3">
            <div className="step3-slot-group shrink-0 rounded-[22px] border border-border/60 bg-background/55 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
                  {coreGroupLabel}
                </Badge>
                <span className="text-xs text-muted-foreground">{coreGroupDescription}</span>
              </div>
              <div className="flex flex-nowrap items-start gap-3">
                {coreItems.map((item) => {
                  const baseConceptMeta = CHAR_CONCEPTS.find((cm) => cm.concept === item.concept);
                  const groupConceptMeta = isGroupCharacter ? getGroupCharacterConceptMeta(item.concept) : undefined;
                  const conceptMeta = baseConceptMeta && groupConceptMeta
                    ? { ...baseConceptMeta, ...groupConceptMeta }
                    : baseConceptMeta;
                  if (!conceptMeta) return null;
                  const isEditing = editingKey === item.key;

                  return (
                    <div key={item.key} className={`${getCharacterSlotWidthClass(item)} shrink-0`}>
                      <ImageSlot
                        item={item}
                        conceptMeta={conceptMeta}
                        isEditing={isEditing}
                        assetLibrary={assetLibrary}
                        projectId={projectId}
                        onThumbClick={onThumbClick}
                        onPreview={onPreview}
                        onDrop={onDrop}
                        getConceptLabel={getConceptLabel}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {outfitGroups.map((group) => (
              <div key={group.key} className="step3-slot-group step3-slot-group--optional shrink-0 rounded-[22px] border border-border/50 bg-background/40 p-3">
                <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] text-blue-700 dark:text-blue-200">
                    {group.label}
                  </Badge>
                  <span>仅在 Step2 标记需要新图时显示</span>
                </div>
                <div className="flex flex-nowrap items-start gap-3">
                  {group.items.map((item) => {
                    const baseConceptMeta = CHAR_CONCEPTS.find((cm) => cm.concept === item.concept);
                    const groupConceptMeta = isGroupCharacter ? getGroupCharacterConceptMeta(item.concept) : undefined;
                    const conceptMeta = baseConceptMeta && groupConceptMeta
                      ? { ...baseConceptMeta, ...groupConceptMeta }
                      : baseConceptMeta;
                    if (!conceptMeta) return null;
                    const isEditing = editingKey === item.key;

                    return (
                      <div key={item.key} className={`${getCharacterSlotWidthClass(item)} shrink-0`}>
                        <ImageSlot
                          item={item}
                          conceptMeta={conceptMeta}
                          isEditing={isEditing}
                          assetLibrary={assetLibrary}
                          projectId={projectId}
                          onThumbClick={onThumbClick}
                          onPreview={onPreview}
                          onDrop={onDrop}
                          getConceptLabel={getConceptLabel}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {editing && editing.name === ir.name && editing.type === ir.type && (
        <EditPanel
          item={editing}
          assetLibrary={assetLibrary}
          getConceptLabel={getConceptLabel}
          getConceptDesc={getConceptDesc}
          officialMode={officialMode}
          showAssetPicker={showAssetPicker}
          onUpdateItem={onUpdateItem}
          onGenerate={onGenerate}
          onOptimize={onOptimize}
          onFileUpload={onFileUpload}
          onReplaceImage={onReplaceImage}
          onSelectFromLibrary={onSelectFromLibrary}
          onDownload={onDownload}
          onDrop={onDrop}
          onImageSizeChange={onImageSizeChange}
          onReset={onReset}
          onSetDefault={onSetDefault}
          descriptionPreview={buildDescription(editing)}
          contextPreview={buildContext(editing)}
          sourcePreview={buildSourcePreview(editing)}
          onPreview={onPreview}
          onOpenVirtualHumanPicker={onOpenVirtualHumanPicker}
          setShowAssetPicker={setShowAssetPicker}
        />
      )}
    </Card>
  );
}

// ============================================================
// 场景卡片
// ============================================================

export function SceneCard({
  items,
  allDone,
  editingKey,
  onThumbClick,
  onPreview,
  assetLibrary,
  projectId,
  getConceptLabel,
  getConceptDesc,
  editing,
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
  buildDescription,
  buildContext,
  buildSourcePreview,
  setShowAssetPicker,
}: {
  ir: ImageReference;
  items: AssetItem[];
  allDone: boolean;
  editingKey: string | null;
  onThumbClick: (key: string) => void;
  onPreview: (url: string | null) => void;
  assetLibrary: Asset[];
  projectId?: string;
  getConceptLabel: (c: ImageConcept) => string;
  getConceptDesc: (c: ImageConcept) => string;
  editing: AssetItem | null;
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
  buildDescription: (item: AssetItem) => string;
  buildContext: (item: AssetItem) => string | undefined;
  buildSourcePreview: (item: AssetItem) => AssetPromptSourcePreview;
  setShowAssetPicker: (v: boolean) => void;
}) {
  const sceneName = items[0]?.name ?? '';
  return (
    <Card className="step3-asset-card step3-scene-card overflow-hidden rounded-[24px] border-border/60 bg-card/75 shadow-card">
      <div className="step3-asset-card-header border-b border-border/60 bg-gradient-to-r from-emerald-500/8 via-background/80 to-background/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📍</span>
          <span className="font-semibold text-sm">{sceneName}</span>
          {allDone ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          )}
          <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
            {items.filter((item) => item.asset).length}/{items.length} 场景图
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">横屏和竖屏是两张同级场景导演板：横屏供 16:9 视频调用，竖屏供 9:16 视频调用；都要锁定主环境图、高对比俯视走位、放大 CAMERA 1-6、固定图例和空间锚点对应。</p>
      </div>

      <div className="step3-asset-card-body p-3">
        <div className="flex flex-wrap gap-3">
          {items.map((item) => (
            <div key={item.key} className={item.aspectRatio === 'PORTRAIT' ? 'w-[136px] sm:w-[148px]' : 'w-[224px] sm:w-[256px]'}>
              <ImageSlot
                item={item}
                conceptMeta={getSceneConceptMeta(item.concept) ?? { concept: item.concept, label: getConceptLabel(item.concept), aspectRatio: item.aspectRatio }}
                isEditing={editingKey === item.key}
                assetLibrary={assetLibrary}
                projectId={projectId}
                onThumbClick={onThumbClick}
                onPreview={onPreview}
                onDrop={onDrop}
                getConceptLabel={getConceptLabel}
              />
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <EditPanel
          item={editing}
          assetLibrary={assetLibrary}
          projectId={projectId}
          getConceptLabel={getConceptLabel}
          getConceptDesc={getConceptDesc}
          showAssetPicker={showAssetPicker}
          onUpdateItem={onUpdateItem}
          onGenerate={onGenerate}
          onOptimize={onOptimize}
          onFileUpload={onFileUpload}
          onReplaceImage={onReplaceImage}
          onSelectFromLibrary={onSelectFromLibrary}
          onDownload={onDownload}
          onDrop={onDrop}
          onImageSizeChange={onImageSizeChange}
          onReset={onReset}
          descriptionPreview={buildDescription(editing)}
          contextPreview={buildContext(editing)}
          sourcePreview={buildSourcePreview(editing)}
          onPreview={onPreview}
          setShowAssetPicker={setShowAssetPicker}
        />
      )}
    </Card>
  );
}

// ============================================================
// 物品/道具卡片
// ============================================================

export function PropCard({
  item,
  propInfo,
  isEditing,
  onThumbClick,
  onPreview,
  assetLibrary,
  projectId,
  getConceptLabel,
  editing,
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
  buildDescription,
  buildContext,
  buildSourcePreview,
  setShowAssetPicker,
}: {
  ir: ImageReference;
  item: AssetItem;
  propInfo?: PropConsistency;
  isEditing: boolean;
  onThumbClick: (key: string) => void;
  onPreview: (url: string | null) => void;
  assetLibrary: Asset[];
  projectId?: string;
  getConceptLabel: (c: ImageConcept) => string;
  editing: AssetItem | null;
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
  buildDescription: (item: AssetItem) => string;
  buildContext: (item: AssetItem) => string | undefined;
  buildSourcePreview: (item: AssetItem) => AssetPromptSourcePreview;
  setShowAssetPicker: (v: boolean) => void;
}) {
  return (
    <Card className="step3-asset-card step3-prop-card overflow-hidden rounded-[24px] border-border/60 bg-card/75 shadow-card">
      <div className="step3-asset-card-header border-b border-border/60 bg-gradient-to-r from-violet-500/8 via-background/80 to-background/80 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-lg">🎒</span>
          <span className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">{item.name}</span>
        {getSafePropHolderLabel(propInfo?.holder) && (
            <Badge variant="outline" className="h-auto max-w-full whitespace-normal break-words rounded-full px-2 py-0.5 text-[10px] [overflow-wrap:anywhere]">持有者：{getSafePropHolderLabel(propInfo?.holder)}</Badge>
        )}
        {propInfo?.storyboardRange && (
            <Badge variant="outline" className="h-auto max-w-full whitespace-normal break-words rounded-full px-2 py-0.5 text-[10px] text-muted-foreground [overflow-wrap:anywhere]">{propInfo.storyboardRange}</Badge>
        )}
        {item.asset ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-yellow-500" />
        )}
        </div>
        {propInfo?.appearanceDesc && (
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{propInfo.appearanceDesc}</p>
        )}
      </div>

      {/* 物品描述区 */}
      {propInfo && (
        <div className="step3-prop-desc border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap gap-3">
            {propInfo.appearanceDesc && <span className="min-w-0 break-words [overflow-wrap:anywhere]">外观：{propInfo.appearanceDesc}</span>}
            {propInfo.stateChanges && <span className="min-w-0 break-words [overflow-wrap:anywhere]">状态：{propInfo.stateChanges}</span>}
          </div>
        </div>
      )}

      <div className="step3-asset-card-body p-3">
        <div className="max-w-xs">
          <ImageSlot
            item={item}
            conceptMeta={PROP_CONCEPT}
            isEditing={isEditing}
            assetLibrary={assetLibrary}
            projectId={projectId}
            onThumbClick={onThumbClick}
            onPreview={onPreview}
            onDrop={onDrop}
            getConceptLabel={getConceptLabel}
          />
        </div>
      </div>

      {editing && editing.key === item.key && (
        <EditPanel
          item={editing}
          assetLibrary={assetLibrary}
          projectId={projectId}
          getConceptLabel={getConceptLabel}
          getConceptDesc={() => PROP_CONCEPT.desc}
          showAssetPicker={showAssetPicker}
          onUpdateItem={onUpdateItem}
          onGenerate={onGenerate}
          onOptimize={onOptimize}
          onFileUpload={onFileUpload}
          onReplaceImage={onReplaceImage}
          onSelectFromLibrary={onSelectFromLibrary}
          onDownload={onDownload}
          onDrop={onDrop}
          onImageSizeChange={onImageSizeChange}
          onReset={onReset}
          descriptionPreview={buildDescription(editing)}
          contextPreview={buildContext(editing)}
          sourcePreview={buildSourcePreview(editing)}
          onPreview={onPreview}
          setShowAssetPicker={setShowAssetPicker}
        />
      )}
    </Card>
  );
}

// ============================================================
// 展开的编辑面板
