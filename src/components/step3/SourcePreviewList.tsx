import { Badge } from '@/components/ui/badge';
import type { AssetPromptSourcePreview } from './assetPromptDerivation';

function getSourceToneClasses(tone: AssetPromptSourcePreview['descriptionSources'][number]['tone']) {
  if (tone === 'step2') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (tone === 'structured') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200';
  if (tone === 'raw') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
  return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200';
}

interface SourcePreviewListProps {
  title: string;
  hint: string;
  entries: AssetPromptSourcePreview['descriptionSources'];
}

export function SourcePreviewList({
  title,
  hint,
  entries,
}: SourcePreviewListProps) {
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="rounded-full px-2 text-[10px]">
          {title}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={`${entry.label}:${entry.value}`} className="min-w-0 rounded-xl border border-border/60 bg-background/70 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Badge variant="outline" className={`rounded-full px-2 text-[10px] ${getSourceToneClasses(entry.tone)}`}>
                {entry.label}
              </Badge>
            </div>
            <p className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90 [overflow-wrap:anywhere]">
              {entry.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
