import { Label } from '@/components/ui/label';
import { CheckCircle2, ImageIcon } from '@/components/icons';
import type { Asset, ImageConcept } from '@/types';
import {
  formatAssetCreatedAt,
  getAssetVersionLabel,
} from './assetUtils';
import { useAssetThumbnail } from './useAssetThumbnail';

interface AssetPickerPanelProps {
  assets: Asset[];
  projectId?: string;
  currentAssetId?: string;
  onSelect: (asset: Asset) => void;
  onCancel: () => void;
  getConceptLabel: (concept: ImageConcept) => string;
}

export function AssetPickerPanel({
  assets,
  projectId,
  currentAssetId,
  onSelect,
  onCancel,
  getConceptLabel,
}: AssetPickerPanelProps) {
  return (
    <div className="space-y-2 border rounded-lg p-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">选择已有资产</Label>
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={onCancel}>取消</button>
      </div>
      {assets.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">资产库中没有同类资产</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
          {assets.map((asset) => (
            <AssetPickerCard
              key={asset.id}
              asset={asset}
              assetLibrary={assets}
              projectId={projectId}
              isCurrent={asset.id === currentAssetId}
              onSelect={() => onSelect(asset)}
              getConceptLabel={getConceptLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetPickerCard({
  asset,
  assetLibrary,
  projectId,
  isCurrent,
  onSelect,
  getConceptLabel,
}: {
  asset: Asset;
  assetLibrary: Asset[];
  projectId?: string;
  isCurrent: boolean;
  onSelect: () => void;
  getConceptLabel: (concept: ImageConcept) => string;
}) {
  const thumbUrl = useAssetThumbnail(asset, undefined, projectId);
  const versionLabel = getAssetVersionLabel(asset, assetLibrary);
  const createdAtLabel = formatAssetCreatedAt(asset);

  return (
    <button
      onClick={onSelect}
      className={`relative rounded-md border overflow-hidden transition-all text-left ${
        isCurrent ? 'ring-2 ring-primary border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/50'
      }`}
    >
      <div className={`${asset.aspectRatio === 'PORTRAIT' ? 'aspect-[3/4]' : 'aspect-video'} bg-muted flex items-center justify-center`}>
        {thumbUrl ? (
          <img src={thumbUrl} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
        )}
      </div>
      <div className="px-1 py-0.5 bg-background">
        <div className="flex items-center gap-0.5">
          <span className="text-[8px] font-medium truncate flex-1">{asset.name}</span>
          <span className="text-[7px] text-muted-foreground">{getConceptLabel(asset.concept)}</span>
          {isCurrent && <CheckCircle2 className="h-2.5 w-2.5 text-primary shrink-0" />}
        </div>
        <div className="mt-0.5 truncate text-[7px] text-muted-foreground">
          {versionLabel}{createdAtLabel ? ` · ${createdAtLabel}` : ''}
        </div>
      </div>
    </button>
  );
}
