import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Loader2, RotateCcw, X } from '@/components/icons';
import type { ScenePositionBoardPoint, ScenePositionBoardState, SceneSpatialMasterState } from '@/types';
import { formatShortDramaLayout } from './scenePositionBoard';
import { normalizeFrameRatio } from '@/lib/frameRatio';

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function ScenePositionBoardCard({
  board,
  previewUrl,
  points,
  disabledReason,
  isGenerating,
  hasFreshBoard,
  hasFreshSceneMaster,
  sceneMaster,
  sceneMasterViewLabel,
  onGenerate,
  onNudgePoint,
  onClear,
  onDownload,
}: {
  board?: ScenePositionBoardState;
  previewUrl: string | null;
  points: ScenePositionBoardPoint[];
  disabledReason: string | null;
  isGenerating: boolean;
  hasFreshBoard: boolean;
  hasFreshSceneMaster: boolean;
  sceneMaster?: SceneSpatialMasterState;
  sceneMasterViewLabel: string;
  onGenerate: () => void;
  onNudgePoint: (character: string, dx: number, dy: number) => void;
  onClear: () => void;
  onDownload: () => void;
}) {
  const frameRatio = normalizeFrameRatio(board?.frameRatio ?? sceneMaster?.frameRatio);
  const frameLabel = frameRatio === '16:9' ? '横屏' : '竖屏';
  const previewClassName = frameRatio === '16:9'
    ? 'relative mx-auto aspect-video w-full max-w-[320px] overflow-hidden rounded-lg border bg-muted'
    : 'relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-lg border bg-muted';
  const emptyClassName = frameRatio === '16:9'
    ? 'mx-auto flex aspect-video w-full max-w-[320px] items-center justify-center rounded-lg border border-dashed bg-background/60 text-xs text-muted-foreground'
    : 'mx-auto flex aspect-[9/16] w-full max-w-[220px] items-center justify-center rounded-lg border border-dashed bg-background/60 text-xs text-muted-foreground';
  const statusLabel = isGenerating
    ? '生成中'
    : hasFreshBoard
      ? '可用于视频'
      : board?.status === 'failed'
        ? '失败'
        : board?.isStale
          ? '已过期'
          : '待生成';

  return (
    <Card className="border-blue-200/70 bg-blue-50/55 dark:border-blue-400/20 dark:bg-blue-500/10">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">场景定位图</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              色点记录人物脚下落位，系统会自动补充{frameLabel}短剧的人脸安全区和主体可见约束；Step5 只占 1 个参考图位。
            </p>
          </div>
          <Badge variant={hasFreshBoard ? 'default' : 'outline'}>{statusLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {previewUrl ? (
          <div className={previewClassName}>
            <img src={previewUrl} alt="场景定位图" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className={emptyClassName}>
            尚未生成定位图
          </div>
        )}

        {board?.warning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {board.warning}
          </div>
        )}
        {board?.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
            {board.error}
          </div>
        )}
        {disabledReason && !isGenerating && (
          <div className="rounded-lg border border-dashed px-3 py-2 text-xs leading-5 text-muted-foreground">
            {disabledReason}
          </div>
        )}
        {!disabledReason && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={hasFreshSceneMaster ? 'default' : 'outline'}>
              {hasFreshSceneMaster ? `${sceneMasterViewLabel}母版可复用` : sceneMaster?.status === 'generating' ? `${sceneMasterViewLabel}母版生成中` : `待生成${sceneMasterViewLabel}母版`}
            </Badge>
            {board?.sceneMasterReused && <span>当前标注图来自共享母版</span>}
          </div>
        )}

        {points.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground">色点位置</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {points.map((point) => (
                <div key={point.character} className="rounded-lg border bg-background/70 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-3 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: point.colorHex }}
                      />
                      <span className="truncate font-medium">{point.character}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {point.colorName} {formatPercent(point.x)}, {formatPercent(point.y)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-1 text-[10px]" disabled={!board?.cleanBlobKey} onClick={() => onNudgePoint(point.character, -0.03, 0)}>左</Button>
                    <Button size="sm" variant="outline" className="h-7 px-1 text-[10px]" disabled={!board?.cleanBlobKey} onClick={() => onNudgePoint(point.character, 0.03, 0)}>右</Button>
                    <Button size="sm" variant="outline" className="h-7 px-1 text-[10px]" disabled={!board?.cleanBlobKey} onClick={() => onNudgePoint(point.character, 0, -0.03)}>上</Button>
                    <Button size="sm" variant="outline" className="h-7 px-1 text-[10px]" disabled={!board?.cleanBlobKey} onClick={() => onNudgePoint(point.character, 0, 0.03)}>下</Button>
                  </div>
                  <div className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                    {formatShortDramaLayout(point, frameRatio)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onGenerate} disabled={!!disabledReason || isGenerating}>
            {isGenerating ? <Loader2 className="mr-1 size-3 animate-spin" /> : <RotateCcw className="mr-1 size-3" />}
            {hasFreshBoard ? '刷新定位图' : '生成定位图'}
          </Button>
          <Button size="sm" variant="outline" onClick={onDownload} disabled={!board?.markedBlobKey}>
            <Download className="mr-1 size-3" />
            下载
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={!board}>
            <X className="mr-1 size-3" />
            清除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
