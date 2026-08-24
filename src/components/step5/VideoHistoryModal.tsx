import { useCallback, useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowRight, Download, Loader2, Trash2 } from '@/components/icons';
import { volcDeleteTask, volcListHistoryTasks, type VolcHistoryTask } from '@/lib/volcHistoryClient';
import type { VideoApiConfig } from '@/types';

interface VideoHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoConfig: VideoApiConfig;
  currentStoryboardLabel?: string;
  onUseTaskResult?: (task: VolcHistoryTask) => Promise<void> | void;
  usingTaskId?: string | null;
  onConfirmDeleteTask?: (taskId: string) => Promise<boolean>;
}

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  succeeded: { label: '成功', variant: 'default' },
  running: { label: '进行中', variant: 'secondary' },
  queued: { label: '排队中', variant: 'outline' },
  failed: { label: '失败', variant: 'destructive' },
  expired: { label: '已过期', variant: 'outline' },
  canceled: { label: '已取消', variant: 'outline' },
};

export function VideoHistoryModal({
  open,
  onOpenChange,
  videoConfig,
  currentStoryboardLabel,
  onUseTaskResult,
  usingTaskId,
  onConfirmDeleteTask,
}: VideoHistoryModalProps) {
  const [tasks, setTasks] = useState<VolcHistoryTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  const pageSize = 20;

  const loadHistory = useCallback(async () => {
    if (videoConfig.backend !== 'volcengine' || !videoConfig.volcApiKey) {
      toast.error('请先配置火山引擎视频 API Key。');
      return;
    }

    setLoading(true);
    try {
      const result = await volcListHistoryTasks(videoConfig, {
        page,
        page_size: pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setTasks(result.tasks);
      setTotal(result.total);
    } catch (error) {
      toast.error(`查询任务失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, videoConfig]);

  useEffect(() => {
    if (!open) return;
    void loadHistory();
  }, [open, loadHistory]);

  const handleDelete = useCallback(async (taskId: string) => {
    const confirmed = onConfirmDeleteTask
      ? await onConfirmDeleteTask(taskId)
      : window.confirm('确定要删除这个火山历史任务吗？删除后可能无法再通过任务列表恢复结果。');
    if (!confirmed) return;

    const result = await volcDeleteTask(videoConfig, taskId);
    if (result.success) {
      toast.success(result.message);
      void loadHistory();
    } else {
      toast.error(result.message);
    }
  }, [loadHistory, onConfirmDeleteTask, videoConfig]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col">
        <DialogHeader className="space-y-2">
          <DialogTitle>火山任务恢复面板</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>这里可以查看火山历史任务、打开成片、删除任务，或把成功结果重新绑定到当前分镜。</p>
              {currentStoryboardLabel && (
                <p className="text-xs">当前目标分镜：{currentStoryboardLabel}</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="succeeded">成功</SelectItem>
              <SelectItem value="running">进行中</SelectItem>
              <SelectItem value="queued">排队中</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="expired">已过期</SelectItem>
              <SelectItem value="canceled">已取消</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => void loadHistory()} disabled={loading}>
            <Loader2 className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>

          <span className="ml-auto text-xs text-muted-foreground">
            共 {total} 条任务
          </span>
        </div>

        <div className="flex-1 overflow-y-auto rounded-2xl border border-white/70 bg-white/40 dark:border-white/10 dark:bg-white/5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">暂无可用任务</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/95 backdrop-blur">
                <tr className="border-b text-left">
                  <th className="px-3 py-3">任务 ID</th>
                  <th className="px-3 py-3">状态</th>
                  <th className="px-3 py-3">模型</th>
                  <th className="px-3 py-3">创建时间</th>
                  <th className="px-3 py-3">说明</th>
                  <th className="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const statusInfo = STATUS_MAP[task.status] || { label: task.status, variant: 'outline' as const };
                  const canUseResult = task.status === 'succeeded' && !!task.video_url && !!onUseTaskResult;
                  const isUsingCurrentTask = usingTaskId === task.id;

                  return (
                    <tr key={task.id} className="border-b align-top hover:bg-muted/20">
                      <td className="px-3 py-3 font-mono text-xs">
                        <div>{task.id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs">{task.model}</td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {new Date(task.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {task.status_msg || (task.video_url ? '已返回可下载成片' : '当前还没有成片 URL')}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          {task.video_url && (
                            <a href={task.video_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" title="打开远端成片">
                                <ArrowRight className="mr-1 h-3.5 w-3.5" />
                                打开结果
                              </Button>
                            </a>
                          )}

                          {canUseResult && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void onUseTaskResult?.(task)}
                              disabled={isUsingCurrentTask}
                              title="把这个历史任务结果绑定到当前分镜"
                            >
                              {isUsingCurrentTask ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="mr-1 h-3.5 w-3.5" />
                              )}
                              {isUsingCurrentTask ? '导入中...' : '绑定到当前分镜'}
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDelete(task.id)}
                            title="删除历史任务"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {total > pageSize && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">
              第 {page} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
