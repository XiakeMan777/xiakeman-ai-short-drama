import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from '@/components/icons';
import {
  getEntityResolutionTypeLabel,
  type EntityResolutionSuggestion,
} from '@/lib/entityResolution';

interface EntityResolutionPanelProps {
  suggestions: EntityResolutionSuggestion[];
  highConfidenceSuggestions: EntityResolutionSuggestion[];
  hasComparableChapterAnalysis: boolean;
  isAnalysisStale: boolean;
  onMergeHighConfidence: () => void;
  onDismiss: (suggestionId: string) => void;
  onMerge: (suggestion: EntityResolutionSuggestion) => void;
}

export function EntityResolutionPanel({
  suggestions,
  highConfidenceSuggestions,
  hasComparableChapterAnalysis,
  isAnalysisStale,
  onMergeHighConfidence,
  onDismiss,
  onMerge,
}: EntityResolutionPanelProps) {
  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/55 p-3 text-sm shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-emerald-950 dark:text-emerald-100">
            🔗 跨章节实体复用
          </p>
          <Badge variant="outline" className="border-emerald-200 bg-white/70 text-[11px] text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-100">
            当前无待合并
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-5 text-emerald-900/80 dark:text-emerald-100/75">
          {hasComparableChapterAnalysis
            ? '已检查其他章节和资产库，暂时没有发现高相似别名。若后续出现“疤脸兵/刀疤脸”这类叫法变化，会在这里提示合并复用。'
            : '当前还没有可比对的已分析章节。第二章分析完成后，这里会自动提示疑似同一角色、场景或物品，减少重复生图。'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-emerald-950 dark:text-emerald-100">
          🔗 跨章节实体一致性
        </p>
        <Badge variant="outline" className="border-emerald-200 bg-white/75 text-[11px] text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-100">
          疑似 {suggestions.length} 项
        </Badge>
        {highConfidenceSuggestions.length > 0 && (
          <Button
            size="sm"
            className="ml-auto h-7 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
            onClick={onMergeHighConfidence}
            disabled={isAnalysisStale}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            合并安全高置信（{highConfidenceSuggestions.length}）
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-emerald-900/80 dark:text-emerald-100/80">
        系统发现当前章节可能沿用了旧章节的人物、场景或物品，只是叫法不同。安全高置信项可一键合并；泛称角色或证据不足的项会保留人工确认，避免把不同群演误合并。
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="rounded-lg border border-white/75 bg-white/75 p-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-950/45"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[11px]">
                {getEntityResolutionTypeLabel(suggestion.type)}
              </Badge>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {suggestion.currentName}
              </span>
              <span className="text-xs text-muted-foreground">→</span>
              <span className="font-medium text-emerald-800 dark:text-emerald-100">
                {suggestion.canonicalName}
              </span>
              <Badge variant="outline" className="ml-auto text-[11px]">
                {Math.round(suggestion.confidence * 100)}%
              </Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {suggestion.reason}；来源：{suggestion.sourceLabel}
            </p>
            {suggestion.autoApplyBlockedReason && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-4 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                需人工确认：{suggestion.autoApplyBlockedReason}
              </p>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => onDismiss(suggestion.id)}
              >
                保留为新实体
              </Button>
              <Button
                size="sm"
                className="h-7 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700"
                onClick={() => onMerge(suggestion)}
              >
                合并并复用
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
