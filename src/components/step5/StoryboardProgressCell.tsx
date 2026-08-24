// ============================================================
// Step5: 分镜进度格子（PERF2: memo 化，独立组件减少重渲染）
// U3: 点击已完成格子直接预览
// F5: 显示队列状态信息
// ============================================================

import { memo, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, Film } from '@/components/icons';

interface StoryboardProgressCellProps {
  index: number;
  number: number;
  name: string | undefined;
  status: 'idle' | 'submitting' | 'polling' | 'done' | 'failed';
  progress: number;
  statusDetail: string | null;
  isActive: boolean;
  isSelected: boolean;
  isSelectMode: boolean;
  isSelectable: boolean;
  selectDisabledReason?: string | null;
  onClick: (index: number, isSelectable: boolean) => void;
}

export const StoryboardProgressCell = memo(function StoryboardProgressCell({
  index,
  number,
  status,
  progress,
  statusDetail,
  isActive,
  isSelected,
  isSelectMode,
  isSelectable,
  selectDisabledReason,
  onClick,
}: StoryboardProgressCellProps) {
  const handleClick = useCallback(() => {
    onClick(index, isSelectable);
  }, [index, isSelectable, onClick]);

  return (
    <button
      onClick={handleClick}
      title={isSelectMode && !isSelectable ? (selectDisabledReason ?? '当前镜头不能加入批量生成') : undefined}
      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
        isSelected
          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
          : isActive
            ? 'border-primary bg-primary/5 font-medium'
            : status === 'done'
              ? 'border-green-200 bg-green-50 hover:border-green-400 cursor-pointer'
              : 'border-muted hover:border-muted-foreground/50'
      } ${isSelectMode && !isSelectable ? 'cursor-not-allowed opacity-55 hover:border-muted' : ''}`}
    >
      <div className="flex items-center gap-1">
        {isSelectMode && (
          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${
            isSelected
              ? 'border-primary bg-primary text-primary-foreground'
              : isSelectable
                ? 'border-muted-foreground/40'
                : 'border-muted-foreground/20 bg-muted/40'
          }`}>
            {isSelected && '✓'}
          </span>
        )}
        <span className="font-mono">{String(number).padStart(2, '0')}</span>
      </div>
      {status === 'done' ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : status === 'failed' ? (
        <XCircle className="h-4 w-4 text-red-500" />
      ) : status === 'polling' || status === 'submitting' ? (
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      ) : (
        <Film className="h-4 w-4 text-muted-foreground" />
      )}
      {status === 'polling' && (
        <span className="text-[10px] text-blue-500">
          {statusDetail || `${progress}%`}
        </span>
      )}
      {/* F5: 队列状态标签 */}
      {status === 'submitting' && (
        <span className="text-[10px] text-amber-500">提交中</span>
      )}
    </button>
  );
});
