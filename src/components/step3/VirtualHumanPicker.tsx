import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle2, Search } from '@/components/icons';
import type { CharacterProfile } from '@/types';
import {
  loadVolcVirtualHumanCatalog,
  type VolcVirtualHuman,
} from '@/lib/volcVirtualHumanCatalog';
import {
  inferVirtualHumanTargetGender,
  matchVirtualHumans,
  type VirtualHumanMatch,
} from './virtualHumanMatcher';

interface VirtualHumanPickerProps {
  open: boolean;
  characterName: string;
  profile?: CharacterProfile;
  context?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (person: VolcVirtualHuman) => void;
}

type PickerTab = 'recommended' | 'all';

const ANY_VALUE = '__any__';

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function fallbackAvatarLabel(name: string) {
  return name.trim().slice(0, 2) || '官';
}

function getPersonMeta(person: VolcVirtualHuman) {
  return [
    person.nationality,
    person.age ? `${person.age}岁` : person.ageGroup,
    person.gender,
    person.occupation,
  ].filter(Boolean).join(' · ');
}

function prioritizeDisplayReasons(reasons: string[]) {
  return [...reasons].sort((a, b) => {
    const aPerformance = a.includes('表演') || a.includes('演员');
    const bPerformance = b.includes('表演') || b.includes('演员');
    return Number(bPerformance) - Number(aPerformance);
  });
}

function VirtualHumanImage({
  person,
  className,
}: {
  person: VolcVirtualHuman;
  className: string;
}) {
  if (person.thumbnailUrl) {
    return (
      <img
        src={person.thumbnailUrl}
        alt={person.name}
        loading="lazy"
        decoding="async"
        className={className}
      />
    );
  }

  return (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-blue-100 to-orange-100 text-xl font-semibold text-blue-700`}>
      {fallbackAvatarLabel(person.name)}
    </div>
  );
}

export function VirtualHumanPicker({
  open,
  characterName,
  profile,
  context,
  onOpenChange,
  onSelect,
}: VirtualHumanPickerProps) {
  const [catalog, setCatalog] = useState<VolcVirtualHuman[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PickerTab>('recommended');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState(ANY_VALUE);
  const [ageGroup, setAgeGroup] = useState(ANY_VALUE);

  useEffect(() => {
    if (!open || catalog.length > 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });
    loadVolcVirtualHumanCatalog()
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setSelectedAssetId(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog.length, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTab('recommended');
      setQuery('');
      setGender(ANY_VALUE);
      setAgeGroup(ANY_VALUE);
      setSelectedAssetId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [characterName, open]);

  const targetGender = useMemo(
    () => inferVirtualHumanTargetGender({ characterName, profile, context }),
    [characterName, context, profile],
  );

  useEffect(() => {
    if (!open || !targetGender || tab !== 'all' || gender !== ANY_VALUE) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setGender(targetGender);
    });
    return () => {
      cancelled = true;
    };
  }, [gender, open, tab, targetGender]);

  const rawRecommended = useMemo(
    () => matchVirtualHumans(
      { characterName, profile, context },
      catalog,
      Math.max(1, catalog.length),
    ),
    [catalog, characterName, profile, context],
  );

  const recommendedGender = useMemo(() => {
    if (gender !== ANY_VALUE) return gender;
    if (targetGender) return targetGender;
    return rawRecommended[0]?.person.gender || ANY_VALUE;
  }, [gender, rawRecommended, targetGender]);

  const recommended = useMemo(
    () => {
      const matches = recommendedGender === ANY_VALUE
        ? rawRecommended
        : rawRecommended.filter((match) => match.person.gender === recommendedGender);
      return matches;
    },
    [rawRecommended, recommendedGender],
  );

  useEffect(() => {
    if (!open || selectedAssetId || recommended.length === 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedAssetId(recommended[0].person.assetId);
    });
    return () => {
      cancelled = true;
    };
  }, [open, recommended, selectedAssetId]);

  const recommendedMap = useMemo(
    () => new Map(recommended.map((match) => [match.person.assetId, match])),
    [recommended],
  );

  const genders = useMemo(() => uniqueValues(catalog.map((item) => item.gender)), [catalog]);
  const ageGroups = useMemo(() => uniqueValues(catalog.map((item) => item.ageGroup)), [catalog]);

  const filteredAll = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalog.filter((person) => {
      if (gender !== ANY_VALUE && person.gender !== gender) return false;
      if (ageGroup !== ANY_VALUE && person.ageGroup !== ageGroup) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        person.name,
        person.gender,
        person.ageGroup,
        person.nationality,
        person.occupation,
        person.bio,
        ...person.tags,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [ageGroup, catalog, gender, query]);

  const visibleMatches: VirtualHumanMatch[] = useMemo(() => {
    if (tab === 'recommended') return recommended;
    return filteredAll.map((person) => recommendedMap.get(person.assetId) ?? {
      person,
      score: 0,
      reasons: ['手动筛选结果，可根据角色审美判断是否适合'],
    });
  }, [filteredAll, recommended, recommendedMap, tab]);

  const selectedMatch = useMemo(() => {
    return visibleMatches.find((match) => match.person.assetId === selectedAssetId)
      ?? recommended.find((match) => match.person.assetId === selectedAssetId)
      ?? visibleMatches[0]
      ?? null;
  }, [recommended, selectedAssetId, visibleMatches]);

  useEffect(() => {
    if (!selectedMatch && visibleMatches[0]) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setSelectedAssetId(visibleMatches[0].person.assetId);
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [selectedMatch, visibleMatches]);

  const handleUse = () => {
    if (!selectedMatch) return;
    onSelect(selectedMatch.person);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[96vw] gap-0 overflow-hidden p-0 sm:max-w-none xl:w-[1180px]"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-1">
              <SheetTitle className="flex items-center gap-2 text-base">
                官方虚拟人像匹配
                <Badge className="rounded-full border-0 bg-blue-600/90 px-2 text-[10px] text-white">
                  仅锁定身份
                </Badge>
              </SheetTitle>
              <SheetDescription>
                为「{characterName}」选择官方定妆照。后续服装、装备会以无脸素材方式生成。
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)_320px]">
          <aside className="border-b border-border/60 bg-muted/20 p-4 lg:border-b-0 lg:border-r">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  筛选
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  推荐按表演相关和角色画像排序，不限制候选数量，可继续向下滚动挑脸。
                </p>
              </div>

              <Tabs value={tab} onValueChange={(value) => setTab(value as PickerTab)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="recommended" className="text-xs">推荐</TabsTrigger>
                  <TabsTrigger value="all" className="text-xs">全部</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setTab('all');
                  }}
                  placeholder="搜索标签/气质"
                  className="h-9 pl-8 text-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">性别</label>
                <select
                  value={gender}
                  onChange={(event) => {
                    setGender(event.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value={ANY_VALUE}>全部</option>
                  {genders.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                {tab === 'recommended' && recommendedGender !== ANY_VALUE && (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    推荐已按「{recommendedGender}」筛选，可在这里切换。
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">年龄段</label>
                <select
                  value={ageGroup}
                  onChange={(event) => {
                    setAgeGroup(event.target.value);
                    setTab('all');
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value={ANY_VALUE}>全部</option>
                  {ageGroups.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-xs leading-5 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                官方人像不会被下载或转成普通参考图；生成视频时会直接传入 asset:// 官方资源。
              </div>
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4">
            {loading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-64 animate-pulse rounded-lg border border-border/60 bg-muted/40" />
                ))}
              </div>
            ) : error ? (
              <div className="flex h-full min-h-[320px] items-center justify-center">
                <div className="max-w-sm rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/20">
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    目录加载失败
                  </div>
                  <p className="text-xs leading-5">{error}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCatalog([]);
                      setError(null);
                    }}
                    className="mt-3 h-8 text-xs"
                  >
                    重试
                  </Button>
                </div>
              </div>
            ) : catalog.length === 0 ? (
              <div className="flex h-full min-h-[320px] items-center justify-center">
                <div className="max-w-md rounded-lg border border-dashed border-border bg-muted/30 p-5 text-center">
                  <p className="text-sm font-semibold text-foreground">官方人像目录未配置</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    将火山体验中心复制的 asset ID / URI 和缩略图写入 volc-virtual-humans.json 后，这里会自动展示候选人像。
                  </p>
                </div>
              </div>
            ) : visibleMatches.length === 0 ? (
              <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                没有找到符合条件的人像，尝试清空筛选。
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleMatches.map((match) => {
                  const selected = selectedMatch?.person.assetId === match.person.assetId;
                  return (
                    <button
                      key={match.person.assetId}
                      type="button"
                      onClick={() => setSelectedAssetId(match.person.assetId)}
                      className={`overflow-hidden rounded-lg border bg-background text-left transition-all hover:border-blue-400/80 hover:shadow-md ${
                        selected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-border/70'
                      }`}
                    >
                      <div className="aspect-[4/5] bg-muted">
                        <VirtualHumanImage person={match.person} className="h-full w-full object-cover" />
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{match.person.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {getPersonMeta(match.person)}
                            </p>
                          </div>
                          {selected && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {match.person.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline" className="h-5 px-1.5 text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="space-y-1">
                          {prioritizeDisplayReasons(match.reasons).slice(0, 2).map((reason) => (
                            <p key={reason} className="line-clamp-1 rounded-md bg-muted/50 px-2 py-1 text-[11px] leading-4 text-muted-foreground">
                              {reason}
                            </p>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </main>

          <aside className="border-t border-border/60 bg-background p-4 lg:border-l lg:border-t-0">
            {selectedMatch ? (
              <div className="flex h-full flex-col gap-4">
                <div className="overflow-hidden rounded-lg border border-border/70 bg-muted">
                  <VirtualHumanImage person={selectedMatch.person} className="aspect-[4/5] w-full object-cover" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-foreground">{selectedMatch.person.name}</h3>
                    <Badge className="rounded-full border-0 bg-blue-600 text-[10px] text-white">
                      {Math.round(selectedMatch.score)} 分
                    </Badge>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{selectedMatch.person.bio}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground">匹配理由</p>
                  <div className="space-y-1.5">
                    {selectedMatch.reasons.map((reason) => (
                      <div key={reason} className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedMatch.person.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="h-6 px-2 text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto space-y-2">
                  <Button onClick={handleUse} className="h-10 w-full rounded-md text-sm font-semibold">
                    使用这个官方人像
                  </Button>
                  <p className="text-center text-[11px] leading-5 text-muted-foreground">
                    选择后会作为角色定妆照绑定，不会替换现有服装/装备图。
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                请选择一个候选人像
              </div>
            )}
          </aside>
        </div>
      </SheetContent>
    </Sheet>
  );
}
