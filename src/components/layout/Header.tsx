// ============================================================
// 顶栏组件 - 虾客漫品牌化版本
// ============================================================

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  Settings,
  Sparkles,
  Film,
  FileText,
  BarChart3,
  ImageIcon,
  Clapperboard,
  CheckCircle2,
  Circle,
  Moon,
  Sun,
  MessageCircle,
} from '@/components/icons';
import { ApiSettingsModal } from '@/components/shared/ApiSettingsModal';
import { OPEN_API_SETTINGS_EVENT } from '@/components/shared/apiSettingsEvents';
import { BUILD_INFO } from '@/lib/buildInfo';
import { BrandMark } from '@/components/brand/BrandMark';
import { cn } from '@/lib/utils';
import { CommunityGroupDialog } from '@/components/community/CommunityGroupDialog';

interface HeaderProps {
  onNewProject: () => void;
  onOpenHome?: () => void;
  variant?: 'classic' | 'next';
  workflowSteps?: HeaderWorkflowStep[];
}

export type HeaderWorkflowStep = {
  id: 'script' | 'analysis' | 'assets' | 'prompts' | 'videos' | 'render';
  label: string;
  status: 'done' | 'active' | 'todo' | 'blocked';
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
};

const workflowIconMap = {
  script: FileText,
  analysis: BarChart3,
  assets: ImageIcon,
  prompts: Sparkles,
  videos: Film,
  render: Clapperboard,
};

export function Header({ onNewProject, onOpenHome, variant = 'classic', workflowSteps = [] }: HeaderProps) {
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [communityGroupOpen, setCommunityGroupOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const versionLabel = `v${BUILD_INFO.version}`;
  const isNext = variant === 'next';
  const buildLabel = `构建 ${BUILD_INFO.buildTimeShort}`;
  const buildTitle = `${versionLabel} · ${BUILD_INFO.buildTime} · ${BUILD_INFO.buildLabel}`;

  useEffect(() => {
    const openApiSettings = () => setApiSettingsOpen(true);
    window.addEventListener(OPEN_API_SETTINGS_EVENT, openApiSettings);
    return () => window.removeEventListener(OPEN_API_SETTINGS_EVENT, openApiSettings);
  }, []);

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-50 flex h-[72px] items-center gap-4 border-b border-border/60 bg-background/85 px-4 backdrop-blur-2xl transition-colors duration-300 sm:px-6',
          isNext && 'next-header',
        )}
      >
        <button
          type="button"
          className="min-w-0 flex items-center gap-3 rounded-2xl text-left outline-none transition focus-visible:ring-2 focus-visible:ring-brand-orange/40"
          onClick={onOpenHome}
          title="返回工作台"
        >
          <div className="brand-mark-shell rounded-2xl border border-border/50 p-1.5 shadow-brand-sm">
            <BrandMark size={isNext ? 36 : 42} className={cn(isNext ? 'h-9 w-9' : 'h-10 w-10')} />
          </div>
          <div className="min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="truncate bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-[17px] font-bold leading-tight tracking-tight text-transparent">
                虾客漫
              </h1>
              <span
                title={buildTitle}
                className="inline-flex h-5 items-center rounded-full border border-border/60 bg-muted/60 px-1.5 text-[10px] font-medium leading-none text-muted-foreground"
              >
                {versionLabel}
              </span>
            </div>
            <p className="hidden truncate text-[10px] leading-none text-muted-foreground xl:block">
              AI 漫剧短剧创作平台 · xiakeman.com · {buildLabel}
            </p>
          </div>
        </button>

        {isNext && (
          <div className="next-header-center hidden min-w-0 flex-1 items-center justify-center xl:flex">
            {workflowSteps.length > 0 && (
              <nav className="next-workflow-nav" aria-label="创作流程">
                {workflowSteps.map((step, index) => {
                  const StepIcon = workflowIconMap[step.id] ?? Sparkles;
                  const disabled = step.disabled || !step.onClick;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={disabled}
                      onClick={step.onClick}
                      title={step.title}
                      className={cn(
                        'next-workflow-button',
                        `is-${step.status}`,
                        disabled && 'is-disabled',
                      )}
                    >
                      <span className="next-workflow-button-index">{String(index + 1).padStart(2, '0')}</span>
                      <StepIcon className="h-3.5 w-3.5" />
                      <span className="next-workflow-button-label">{step.label}</span>
                      {step.status === 'done' ? (
                        <CheckCircle2 className="next-workflow-button-state h-3.5 w-3.5" />
                      ) : step.status === 'active' ? (
                        <Circle className="next-workflow-button-state h-3.5 w-3.5 fill-current" />
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            )}
            <div className={cn('next-command-search', workflowSteps.length > 0 && 'hidden')}>
              <Sparkles className="h-3.5 w-3.5 text-brand-orange" />
              <span>制作驾驶舱</span>
              <span className="next-command-search-kbd">脚本 → 分镜 → 资产 → 提示词 → 视频 → 成片</span>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-2xl border border-border/60 bg-card/75 p-1 shadow-sm backdrop-blur md:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              className="h-8 w-8 rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="h-5 w-px bg-border/70" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNewProject()}
              title="新建项目"
              className="h-8 gap-1.5 rounded-xl px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden text-sm sm:inline">新建项目</span>
            </Button>
          </div>

          <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-card/75 p-1 shadow-sm backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              className="h-8 w-8 rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onNewProject()}
              title="新建项目"
              className="h-8 w-8 rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setApiSettingsOpen(true)}
              className="h-8 gap-1.5 rounded-xl px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">API 设置</span>
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommunityGroupOpen(true)}
            className="h-10 gap-1.5 rounded-2xl border border-brand-orange/25 bg-brand-orange/10 px-3 text-brand-orange shadow-sm transition hover:bg-brand-orange/20 hover:text-brand-orange"
            title="加入虾客漫交流群"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">交流群</span>
          </Button>
        </div>
      </header>

      <CommunityGroupDialog open={communityGroupOpen} onOpenChange={setCommunityGroupOpen} />

      <ApiSettingsModal open={apiSettingsOpen} onOpenChange={setApiSettingsOpen} />
    </>
  );
}
