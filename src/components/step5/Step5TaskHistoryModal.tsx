import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, Copy, Loader2, RotateCcw, XCircle } from '@/components/icons';
import {
  clearStep5VideoTaskLogs,
  listStep5VideoTaskLogs,
  type Step5VideoTaskLogEntry,
  type Step5VideoTaskLogStatus,
} from '@/lib/step5VideoTaskLog';
import { getVideoBackendDisplayName } from '@/lib/officialVirtualHumanVideoMode';

interface Step5TaskHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  chapterId?: string;
  onRestoreTask: (entry: Step5VideoTaskLogEntry) => Promise<void>;
  onClearLogs: () => Promise<boolean>;
}

const STATUS_META: Record<Step5VideoTaskLogStatus, { label: string; tone: string }> = {
  submitting: {
    label: '提交中',
    tone: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100',
  },
  submitted: {
    label: '已提交',
    tone: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-100',
  },
  polling: {
    label: '轮询中',
    tone: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-100',
  },
  poll_interrupted: {
    label: '可恢复',
    tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100',
  },
  succeeded_remote: {
    label: '远端成功',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  },
  done: {
    label: '已完成',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  },
  failed: {
    label: '失败',
    tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100',
  },
  cancelled: {
    label: '已取消',
    tone: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
  },
};

function formatTime(timestamp?: number) {
  if (!timestamp) return '未知时间';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function isSeedanceBackend(backend?: string) {
  return backend === 'seedance' || backend === 'seedancecloud';
}

function canRestore(entry: Step5VideoTaskLogEntry) {
  if (entry.videoUrl) return true;
  if (entry.providerTaskId) return true;
  return isSeedanceBackend(entry.backend) && !!entry.clientTaskId;
}

function getTaskIdLabel(entry: Step5VideoTaskLogEntry) {
  return entry.providerTaskId || entry.pendingTaskId || entry.clientTaskId || '未拿到任务号';
}

async function copyText(value: string | undefined) {
  const text = value?.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast.success('已复制任务信息');
}

export function Step5TaskHistoryModal({
  open,
  onOpenChange,
  projectId,
  chapterId,
  onRestoreTask,
  onClearLogs,
}: Step5TaskHistoryModalProps) {
  const [entries, setEntries] = useState<Step5VideoTaskLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'recoverable'>('all');

  const loadEntries = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const nextEntries = await listStep5VideoTaskLogs({ projectId, chapterId, limit: 300 });
      setEntries(nextEntries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`读取本机任务日志失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [chapterId, open, projectId]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const filteredEntries = useMemo(() => (
    statusFilter === 'recoverable'
      ? entries.filter(canRestore)
      : entries
  ), [entries, statusFilter]);

  const handleRestore = async (entry: Step5VideoTaskLogEntry) => {
    setRestoringId(entry.id);
    try {
      await onRestoreTask(entry);
      await loadEntries();
    } finally {
      setRestoringId((current) => (current === entry.id ? null : current));
    }
  };

  const handleClear = async () => {
    const confirmed = await onClearLogs();
    if (!confirmed) return;
    await clearStep5VideoTaskLogs({ projectId, chapterId });
    await loadEntries();
    toast.success('已清空本章本机任务日志');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            Step5 本机任务日志
            <Badge variant="outline" className="rounded-full bg-background/70 text-[10px]">
              IndexedDB
            </Badge>
          </DialogTitle>
          <DialogDescription>
            记录本机提交、任务号、轮询、成功和失败状态；刷新或崩溃后可用于恢复轮询和对账。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              className="h-8 rounded-lg text-xs"
              onClick={() => setStatusFilter('all')}
            >
              全部 {entries.length}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={statusFilter === 'recoverable' ? 'default' : 'outline'}
              className="h-8 rounded-lg text-xs"
              onClick={() => setStatusFilter('recoverable')}
            >
              可恢复 {entries.filter(canRestore).length}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={loadEntries}>
              {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
              刷新
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={handleClear}>
              清空本章
            </Button>
          </div>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取任务日志
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              暂无本机 Step5 任务记录。
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map((entry) => {
                const statusMeta = STATUS_META[entry.status];
                const taskIdLabel = getTaskIdLabel(entry);
                const recovering = restoringId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-white/70 bg-white/70 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`rounded-full text-[10px] ${statusMeta.tone}`}>
                            {entry.status === 'done' || entry.status === 'succeeded_remote'
                              ? <CheckCircle2 className="mr-1 h-3 w-3" />
                              : entry.status === 'failed'
                                ? <XCircle className="mr-1 h-3 w-3" />
                                : null}
                            {statusMeta.label}
                          </Badge>
                          <Badge variant="outline" className="rounded-full bg-background/70 text-[10px]">
                            {getVideoBackendDisplayName(entry.backend ?? 'seedance')}
                          </Badge>
                          <span className="truncate text-sm font-semibold text-foreground">
                            分镜{String(entry.storyboardNumber ?? entry.storyboardIndex + 1).padStart(2, '0')}
                            {entry.storyboardName ? ` · ${entry.storyboardName}` : ''}
                          </span>
                        </div>
                        <div className="grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
                          <div className="truncate">任务号：{taskIdLabel}</div>
                          <div>更新时间：{formatTime(entry.updatedAt)}</div>
                          <div>提交时间：{formatTime(entry.submittedAt ?? entry.createdAt)}</div>
                          <div>{entry.duration ? `时长：${entry.duration}秒` : `进度：${entry.progress ?? 0}%`}</div>
                        </div>
                        {entry.statusDetail && (
                          <div className="text-[11px] text-muted-foreground">状态：{entry.statusDetail}</div>
                        )}
                        {entry.error && (
                          <div className="rounded-lg border border-red-200/70 bg-red-50/70 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
                            {entry.error}
                          </div>
                        )}
                        {entry.promptPreview && (
                          <div className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                            {entry.promptPreview}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg text-xs"
                          onClick={() => copyText([
                            entry.providerTaskId ? `taskId=${entry.providerTaskId}` : '',
                            entry.clientTaskId ? `clientTaskId=${entry.clientTaskId}` : '',
                            entry.videoUrl ? `videoUrl=${entry.videoUrl}` : '',
                          ].filter(Boolean).join('\n'))}
                          disabled={!entry.providerTaskId && !entry.clientTaskId && !entry.videoUrl}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          复制
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 rounded-lg text-xs"
                          disabled={!canRestore(entry) || recovering}
                          onClick={() => handleRestore(entry)}
                        >
                          {recovering ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                          恢复
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
