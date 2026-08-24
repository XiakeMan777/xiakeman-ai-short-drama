import { useState, type DragEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ImageIcon,
  Loader2,
  Upload,
} from '@/components/icons';
import type { Asset, ImageConcept } from '@/types';
import type { AssetItem } from './assetUtils';
import {
  formatAssetCreatedAt,
  getAssetVersionLabel,
} from './assetUtils';
import { isManualEnhancementSlot } from './assetManagerRules';
import { useAssetThumbnail } from './useAssetThumbnail';

interface ImageSlotProps {
  item: AssetItem;
  conceptMeta: { concept: ImageConcept; label: string; aspectRatio: 'PORTRAIT' | 'LANDSCAPE'; order?: number };
  isEditing: boolean;
  assetLibrary: Asset[];
  projectId?: string;
  onThumbClick: (key: string) => void;
  onPreview: (url: string | null) => void;
  onDrop: (e: DragEvent, key: string) => void;
  getConceptLabel: (concept: ImageConcept) => string;
}

export function ImageSlot({
  item,
  conceptMeta,
  isEditing,
  assetLibrary,
  projectId,
  onThumbClick,
  onDrop,
  getConceptLabel,
}: ImageSlotProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const isPortrait = item.aspectRatio === 'PORTRAIT';
  const thumbUrl = useAssetThumbnail(item.asset, item.localBlobUrl, projectId);
  const versionLabel = getAssetVersionLabel(item.asset, assetLibrary);
  const createdAtLabel = formatAssetCreatedAt(item.asset);

  return (
    <div
      className={`group relative rounded-2xl border-2 overflow-hidden cursor-pointer transition-all ${
        isEditing
          ? 'border-primary ring-2 ring-primary/20 shadow-brand-sm'
          : 'border-transparent hover:border-primary/40 hover:shadow-card-hover'
      }`}
      onClick={() => onThumbClick(item.key)}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { setIsDragOver(false); onDrop(e, item.key); }}
    >
      {/* 缩略图区域 */}
      <div className={`${isPortrait ? 'aspect-[9/16]' : 'aspect-video'} bg-muted/60 flex items-center justify-center relative`}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : item.isProcessing ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
        )}

        {/* 拖拽覆盖层 */}
        {isDragOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/20 border-2 border-dashed border-primary z-10">
            <Upload className="h-5 w-5 text-primary" />
          </div>
        )}

        {/* 状态角标 */}
        {item.asset && (
          <div className="absolute top-1 right-1">
            <CheckCircle2 className="h-4 w-4 text-green-500 drop-shadow-sm" />
          </div>
        )}
        {!item.asset && !item.isProcessing && (
          <div className="absolute top-1 right-1">
            <AlertCircle className="h-4 w-4 text-yellow-400 drop-shadow-sm" />
          </div>
        )}
        {item.isProcessing && (
          <div className="absolute top-1 right-1">
            <Loader2 className="h-4 w-4 animate-spin text-primary drop-shadow-sm" />
          </div>
        )}

        {/* 图生图链接标识 */}
        {item.baseAssetId && item.type !== 'scene' && (
          <div className="absolute bottom-1 left-1">
            <Badge className="text-[8px] px-1 py-0 h-4 bg-blue-500 text-white">🔗图生图</Badge>
          </div>
        )}

        {/* 默认图片标识 */}
        {item.asset?.isDefault && (
          <div className="absolute top-1 left-1">
            <Badge className="text-[8px] px-1 py-0 h-4 bg-amber-500 text-white">⭐默认</Badge>
          </div>
        )}

        {item.asset?.source === 'volc_virtual_human' && (
          <div className="absolute bottom-1 left-1">
            <Badge className="h-4 bg-blue-600 px-1 py-0 text-[8px] text-white">官方</Badge>
          </div>
        )}

        {item.asset && (
          <div className="absolute bottom-1 right-1 flex flex-wrap justify-end gap-1">
            {versionLabel && (
              <Badge className="h-4 bg-black/70 px-1 py-0 text-[8px] text-white">{versionLabel}</Badge>
            )}
            {item.imageSize && (
              <Badge className="h-4 bg-black/60 px-1 py-0 text-[8px] text-white">{item.imageSize}</Badge>
            )}
          </div>
        )}
      </div>

      {/* 底部标签 */}
      <div className="bg-background/95 px-2 py-1.5 text-center">
        <div className="flex items-center justify-center gap-1">
          {conceptMeta.order !== undefined && (
            <span className="text-[9px] font-bold text-muted-foreground">{conceptMeta.order}.</span>
          )}
          <span className="text-[10px] font-medium truncate max-w-[120px]">{getConceptLabel(conceptMeta.concept)}</span>
          {isManualEnhancementSlot(item) && (
            <Badge variant="outline" className="h-4 border-blue-200 px-1 text-[8px] text-blue-600 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-200">手动</Badge>
          )}
          <span className="text-[9px] text-muted-foreground">{isPortrait ? '📱' : '🖥'}</span>
        </div>
        {item.variantLabel && (
          <div className="mt-1 truncate text-[9px] text-muted-foreground">{item.variantLabel}</div>
        )}
        {item.asset && (
          <div className="mt-1 truncate text-[9px] text-muted-foreground">
            {versionLabel}{createdAtLabel ? ` · ${createdAtLabel}` : ''}
          </div>
        )}
      </div>

      {/* 展开指示器 */}
      {isEditing && (
        <div className="flex justify-center py-1 bg-primary/10">
          <ChevronDown className="h-3 w-3 text-primary" />
        </div>
      )}
    </div>
  );
}
