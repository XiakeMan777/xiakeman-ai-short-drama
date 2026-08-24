import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from '@/components/icons';
import { getStep4PhaseLabel } from './promptGeneratorUtils';
import type { StoryboardState } from '@/types';

const STEP4_STAGE_FLOW = [
  '导演阐述',
  '故事板规划',
  '动作导演',
  '图片通道',
  'Seedance 提交词',
] as const;

function getStageFlowIndex(stageLabel: string) {
  const normalized = stageLabel.replace(/\s+/g, '');
  if (normalized.includes('Seedance') || normalized.includes('提示词')) return 4;
  if (normalized.includes('图片')) return 3;
  if (normalized.includes('动作导演')) return 2;
  if (normalized.includes('阐述')) return 0;
  if (normalized.includes('规划')) return 1;
  return 1;
}

function formatDuration(ms: number | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface ActiveStreamCardProps {
  storyboard: StoryboardState;
  phase: StoryboardState['status'] | null;
  stageLabel?: string | null;
  stageStartedAt?: number;
  stageLastActivityAt?: number;
  stageTimeoutMs?: number;
  stageTimeoutMode?: 'hard' | 'idle';
  streamText: string;
  streamTextLength?: number;
  backgroundJobMode?: boolean;
  showJumpButton: boolean;
  onJump: () => void;
}

export function ActiveStreamCard({
  storyboard,
  phase,
  stageLabel,
  stageStartedAt,
  stageLastActivityAt,
  stageTimeoutMs,
  stageTimeoutMode = 'hard',
  streamText,
  streamTextLength,
  backgroundJobMode = false,
  showJumpButton,
  onJump,
}: ActiveStreamCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const phaseLabel = getStep4PhaseLabel(phase);
  const receivedChars = Math.max(streamTextLength ?? 0, streamText.trim().length);
  const currentStageLabel = stageLabel || phaseLabel;
  const currentStageIndex = getStageFlowIndex(currentStageLabel);
  const elapsedMs = stageStartedAt ? Math.max(0, now - stageStartedAt) : undefined;
  const idleElapsedMs = stageLastActivityAt ? Math.max(0, now - stageLastActivityAt) : elapsedMs;
  const timeoutElapsedMs = stageTimeoutMode === 'idle' ? idleElapsedMs : elapsedMs;
  const stageProgress = !backgroundJobMode && stageTimeoutMs && elapsedMs !== undefined
    ? Math.min(100, Math.max(4, ((timeoutElapsedMs ?? 0) / stageTimeoutMs) * 100))
    : undefined;
  const isNearTimeout = stageProgress !== undefined && stageProgress >= 85;

  useEffect(() => {
    if (!stageStartedAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stageStartedAt]);

  return (
    <Card className="surface-panel border border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-violet-50 dark:border-indigo-500/20 dark:from-indigo-500/10 dark:via-slate-950 dark:to-violet-500/10">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-indigo-600 px-3 text-white hover:bg-indigo-600">
                {currentStageLabel || '实时回流'}
              </Badge>
              <Badge variant="outline" className="rounded-full border-indigo-200 bg-white/70 text-indigo-900 dark:border-indigo-400/20 dark:bg-white/5 dark:text-indigo-50">
                {phaseLabel}
              </Badge>
            </div>
            <CardTitle className="text-base flex items-center gap-2 text-indigo-950 dark:text-indigo-50">
              <Loader2 className="h-4 w-4 animate-spin" />
              分镜{String(storyboard.storyboard.number).padStart(2, '0')} · {storyboard.storyboard.name}
            </CardTitle>
            <p className="text-xs font-medium text-indigo-700 dark:text-indigo-200">
              当前阶段：{currentStageLabel}
            </p>
          </div>
          {showJumpButton && (
            <Button size="sm" variant="outline" className="rounded-xl bg-white/80 dark:bg-white/5" onClick={onJump}>
              跳转到当前分镜
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-indigo-100/80 bg-white/85 p-4 text-sm leading-relaxed text-indigo-950 dark:border-indigo-400/20 dark:bg-slate-950/70 dark:text-indigo-50">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {backgroundJobMode ? (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-100">
                后台任务运行中，等待当前阶段完成
              </span>
            ) : (
              <span className="text-indigo-900/80 dark:text-indigo-100/80">
                已回流 {receivedChars} 字
              </span>
            )}
            {elapsedMs !== undefined && (
              <span className={`rounded-full px-2 py-0.5 font-medium ${
                isNearTimeout
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-100'
                  : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-100'
              }`}>
                已用 {formatDuration(elapsedMs)}
                {!backgroundJobMode && stageTimeoutMs && stageTimeoutMode === 'hard' ? ` / 上限 ${formatDuration(stageTimeoutMs)}` : ''}
                {!backgroundJobMode && stageTimeoutMs && stageTimeoutMode === 'idle' ? ` · 静默 ${formatDuration(idleElapsedMs)} / ${formatDuration(stageTimeoutMs)}` : ''}
              </span>
            )}
          </div>
          {stageProgress !== undefined && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100/80 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isNearTimeout ? 'bg-amber-500/85' : 'bg-indigo-500/80'}`}
                style={{ width: `${stageProgress}%` }}
              />
            </div>
          )}
          {!backgroundJobMode && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100/80 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${receivedChars > 0 ? 'bg-indigo-500/80' : 'bg-indigo-400/60 animate-pulse'}`}
                style={{ width: `${receivedChars > 0 ? Math.min(100, Math.max(18, 10 + Math.log10(receivedChars + 1) * 18)) : 12}%` }}
              />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STEP4_STAGE_FLOW.map((label, index) => {
              const status = index < currentStageIndex ? 'done' : index === currentStageIndex ? 'active' : 'pending';
              const className = status === 'done'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100'
                : status === 'active'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
              return (
                <span
                  key={label}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${className}`}
                >
                  {index + 1}. {label}
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-indigo-900/70 dark:text-indigo-100/70">
            {backgroundJobMode
              ? '后端非流式任务只显示阶段流转；正文会在当前阶段完成后一次性写回。'
              : '这里只显示阶段流转和字数，不展开正文，避免把模型中间态误当成最终结果。'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
