import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Download } from '@/components/icons';
import { Button } from '@/components/ui/button';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

const STORAGE_KEYS = [
  'drama-skill-pack-v2',
  'drama-api-config',
];

function downloadRecoveryBundle(error: Error | null) {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    reason: error?.message ?? 'unknown',
    storage: Object.fromEntries(
      STORAGE_KEYS.map((key) => [key, window.localStorage.getItem(key)]),
    ),
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `xiakeman-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[AppErrorBoundary]', error, info.componentStack);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="workspace-backdrop flex min-h-screen items-center justify-center px-6 py-10">
        <div className="surface-panel max-w-xl rounded-[28px] border border-amber-200/70 px-6 py-6 text-center shadow-lg dark:border-amber-400/20">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">当前步骤异常</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            项目数据仍保存在本机。可以先导出恢复包，再刷新页面继续；如果重复出现，请把恢复包和当前操作步骤一起用于排查。
          </p>
          <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新继续
            </Button>
            <Button variant="outline" onClick={() => downloadRecoveryBundle(this.state.error)}>
              <Download className="mr-2 h-4 w-4" />
              导出恢复包
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
