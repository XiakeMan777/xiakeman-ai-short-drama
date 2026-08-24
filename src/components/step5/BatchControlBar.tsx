import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, BellOff, CheckCircle2, Download, Play, RotateCcw, Zap } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { VideoProgressSummary } from './useVideoProgressSummary';

interface BatchControlBarProps {
  summary: VideoProgressSummary;
  isBatchGenerating: boolean;
  batchProgress: { current: number; total: number };
  isSelectMode: boolean;
  selectedCount: number;
  batchGenerateDisabledReason?: string | null;
  onToggleSelectMode: () => void;
  onBatchGenerate: () => void | Promise<void>;
  onRetryFailed: () => void;
  onCancelBatch: () => void;
  onExportAll: () => void;
  notificationPermission: NotificationPermission | 'default';
  onRequestNotification: () => void;
  className?: string;
}

export function BatchControlBar({
  summary,
  isBatchGenerating,
  batchProgress,
  isSelectMode,
  selectedCount,
  batchGenerateDisabledReason = null,
  onToggleSelectMode,
  onBatchGenerate,
  onRetryFailed,
  onCancelBatch,
  onExportAll,
  notificationPermission,
  onRequestNotification,
  className,
}: BatchControlBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="批量视频操作"
      className={cn(
        'flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-white/70 bg-white/60 px-2.5 py-1.5 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/55',
        className,
      )}
    >
      {(summary.doneCount > 0 || summary.failedCount > 0) && (
        <Badge variant={summary.failedCount > 0 ? 'destructive' : 'outline'} className="rounded-full">
          已完成视频 {summary.doneCount} 个
          {summary.failedCount > 0 && ` · 失败 ${summary.failedCount} 个`}
        </Badge>
      )}

      {isBatchGenerating ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full">
            镜头视频生成中 {batchProgress.current}/{batchProgress.total}
          </Badge>
          <Button size="sm" variant="destructive" className="rounded-xl" onClick={onCancelBatch}>
            取消
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {summary.totalWithPrompt > 1 && (
            <Button
              size="sm"
              variant={isSelectMode ? 'default' : 'outline'}
              className="rounded-xl bg-white/70 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
              onClick={onToggleSelectMode}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              {isSelectMode ? '退出选择' : '选择要生成的镜头'}
            </Button>
          )}

          {isSelectMode && selectedCount === 0 && (
            <span className="text-xs text-muted-foreground">在进度格中点选待生成镜头</span>
          )}

          {isSelectMode && selectedCount > 0 && (
            <Button
              size="sm"
              variant="default"
              className="step5-next-batch-primary rounded-xl bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] text-white shadow-[0_12px_28px_-18px_rgba(255,92,120,0.9)] hover:opacity-95"
              onClick={() => onBatchGenerate()}
              disabled={!!batchGenerateDisabledReason}
              title={batchGenerateDisabledReason ?? '生成已选镜头'}
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              生成已选镜头（{selectedCount} 个）
            </Button>
          )}

          {!isSelectMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className="step5-next-batch-primary rounded-xl bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] text-white shadow-[0_12px_28px_-18px_rgba(255,92,120,0.9)] hover:opacity-95"
                  disabled={!!batchGenerateDisabledReason}
                  title={batchGenerateDisabledReason ?? '生成本集剩余镜头'}
                >
                  <Zap className="mr-1 h-3.5 w-3.5" />
                  生成本集剩余镜头
                  {summary.failedCount > 0 && <span className="ml-1 text-red-200">({summary.failedCount} 个失败)</span>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {summary.pendingCount > 0 && (
                  <DropdownMenuItem onClick={() => onBatchGenerate()}>
                    <Play className="mr-2 h-3.5 w-3.5" />
                    生成本集剩余镜头视频（{summary.pendingCount} 个）
                  </DropdownMenuItem>
                )}
                {summary.failedCount > 0 && (
                  <DropdownMenuItem onClick={onRetryFailed} className="text-red-600 dark:text-red-300">
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    重试失败项（{summary.failedCount} 个）
                  </DropdownMenuItem>
                )}
                {summary.doneCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onExportAll}>
                      <Download className="mr-2 h-3.5 w-3.5" />
                      导出已完成镜头视频（{summary.doneCount} 个）
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">通知设置</DropdownMenuLabel>
                {notificationPermission !== 'granted' ? (
                  <DropdownMenuItem onClick={onRequestNotification}>
                    <Bell className="mr-2 h-3.5 w-3.5" />
                    开启完成通知
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled>
                    <BellOff className="mr-2 h-3.5 w-3.5" />
                    通知已开启
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!isSelectMode && summary.doneCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl bg-white/70 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
              onClick={onExportAll}
              title="导出全部已完成镜头视频"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              导出已完成视频
            </Button>
          )}

          {batchGenerateDisabledReason && (
            <span className="max-w-[260px] text-xs text-muted-foreground">{batchGenerateDisabledReason}</span>
          )}
        </div>
      )}
    </div>
  );
}
