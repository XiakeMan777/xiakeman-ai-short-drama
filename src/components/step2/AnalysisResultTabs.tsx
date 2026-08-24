import { Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Check, X, Plus, Trash2 } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getPropDefaultAssetFlags } from '@/lib/propTracking';
import { getNextOutfitSeqForCharacter } from './analysisResultUtils';
import {
  getCharacterReviewSummary,
  getOutfitDetailSuggestions,
  getPropDetailSuggestions,
  getPropInferredFieldLabels,
  getSceneDetailSuggestions,
  getSceneInferredFieldLabels,
} from './detailReview';
import type {
  CharacterOutfit,
  CharacterProfile,
  PropConsistency,
  ScriptAnalysis,
  SceneInfo,
  StoryboardInfo,
} from '@/types';

interface AnalysisResultTabsProps {
  analysis: ScriptAnalysis;
  adaptedScript: string;
  analysisSourceText: string;
  saveStoryboardSourceText: (storyboardNumber: number | string, nextSectionText: string) => boolean;
  isReviewFilterActive: boolean;
  reviewFilterLabel: string;
  visibleSceneItems: Array<{ scene: SceneInfo; index: number }>;
  visibleCharacterItems: Array<{ name: string; index: number }>;
  visibleOutfitItems: Array<{ outfit: CharacterOutfit; index: number }>;
  visiblePropItems: Array<{ prop: PropConsistency; index: number }>;
  editSceneIdx: number | null;
  setEditSceneIdx: (value: number | null) => void;
  tempScene: Partial<SceneInfo>;
  setTempScene: Dispatch<SetStateAction<Partial<SceneInfo>>>;
  startEditScene: (index: number) => void;
  saveScene: () => void;
  addScene: () => void;
  deleteScene: (index: number) => void | Promise<void>;
  editCharIdx: number | null;
  setEditCharIdx: (value: number | null) => void;
  tempChar: string;
  setTempChar: Dispatch<SetStateAction<string>>;
  tempCharacterProfile: Partial<CharacterProfile>;
  setTempCharacterProfile: Dispatch<SetStateAction<Partial<CharacterProfile>>>;
  startEditChar: (index: number) => void;
  saveChar: () => void;
  saveCharacterProfile: (characterName: string) => void;
  addChar: () => void;
  deleteChar: (index: number) => void | Promise<void>;
  editSbIdx: number | null;
  setEditSbIdx: (value: number | null) => void;
  tempSb: Partial<StoryboardInfo>;
  setTempSb: Dispatch<SetStateAction<Partial<StoryboardInfo>>>;
  startEditSb: (index: number) => void;
  saveSb: () => void;
  addStoryboard: () => void;
  deleteStoryboard: (index: number) => void | Promise<void>;
  editOutfitIdx: number | null;
  setEditOutfitIdx: (value: number | null) => void;
  tempOutfit: Partial<CharacterOutfit>;
  setTempOutfit: Dispatch<SetStateAction<Partial<CharacterOutfit>>>;
  startEditOutfit: (index: number) => void;
  saveOutfit: () => void;
  addOutfit: () => void;
  deleteOutfit: (index: number) => void | Promise<void>;
  editPropIdx: number | null;
  setEditPropIdx: (value: number | null) => void;
  tempProp: Partial<PropConsistency>;
  setTempProp: Dispatch<SetStateAction<Partial<PropConsistency>>>;
  startEditProp: (index: number) => void;
  saveProp: () => void;
  addProp: () => void;
  deleteProp: (index: number) => void | Promise<void>;
  togglePropNeedsTracking: (index: number, checked: boolean) => void;
  togglePropNeedsImage: (index: number, checked: boolean) => void;
}

function normalizeStoryboardNumber(value: number | string | undefined) {
  const raw = String(value ?? '').trim();
  const digits = raw.match(/\d+/)?.[0] ?? raw;
  return String(Number.parseInt(digits, 10) || digits).padStart(2, '0');
}

function extractStoryboardSourceText(sourceText: string, number: number | string) {
  const text = sourceText.trim();
  if (!text) return '';

  const target = normalizeStoryboardNumber(number);
  const headerPattern = /^(?:#{1,6}\s*)?(?:分镜|镜头|shot|scene)\s*([0-9０-９]+)(?:\s*[-－—–]\s*[0-9０-９]+)?[^\n]*$/gim;
  const matches: Array<{ index: number; end: number; number: string }> = [];

  for (const match of text.matchAll(headerPattern)) {
    const rawNumber = (match[1] ?? '').replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
    matches.push({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      number: normalizeStoryboardNumber(rawNumber),
    });
  }

  const currentIndex = matches.findIndex((match) => match.number === target);
  if (currentIndex < 0) return '';

  const current = matches[currentIndex];
  const next = matches[currentIndex + 1];
  return text.slice(current.index, next?.index ?? text.length).trim();
}

export function replaceStoryboardSourceText(sourceText: string, number: number | string, nextSectionText: string) {
  const text = sourceText.trim();
  const replacement = nextSectionText.trim();
  if (!text || !replacement) return sourceText;

  const target = normalizeStoryboardNumber(number);
  const headerPattern = /^(?:#{1,6}\s*)?(?:分镜|镜头|shot|scene)\s*([0-9０-９]+)(?:\s*[-－—–]\s*[0-9０-９]+)?[^\n]*$/gim;
  const matches: Array<{ index: number; number: string }> = [];

  for (const match of text.matchAll(headerPattern)) {
    const rawNumber = (match[1] ?? '').replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
    matches.push({
      index: match.index ?? 0,
      number: normalizeStoryboardNumber(rawNumber),
    });
  }

  const currentIndex = matches.findIndex((match) => match.number === target);
  if (currentIndex < 0) return sourceText;

  const start = matches[currentIndex].index;
  const end = matches[currentIndex + 1]?.index ?? text.length;
  return `${text.slice(0, start)}${replacement}\n\n${text.slice(end).trimStart()}`.trim();
}

function ScenesTab(props: AnalysisResultTabsProps) {
  const {
    analysis,
    isReviewFilterActive,
    reviewFilterLabel,
    visibleSceneItems,
    editSceneIdx,
    setEditSceneIdx,
    tempScene,
    setTempScene,
    startEditScene,
    saveScene,
    addScene,
    deleteScene,
  } = props;

  return (
        <TabsContent value="scenes" className="mt-4">
      {/* 场景清单 */}
      <Card className="surface-panel border-white/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            📍 场景清单
            <Badge variant="secondary">
              {isReviewFilterActive ? `${visibleSceneItems.length}/${analysis.scenes.length}` : analysis.scenes.length} 项
            </Badge>
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={addScene} title="添加场景">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.scenes.length > 0 ? (
            <div className="space-y-2">
              {visibleSceneItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前“{reviewFilterLabel}”筛选下没有场景项。
                </div>
              )}
              {visibleSceneItems.map(({ scene, index: i }) => (
                <div
                  key={i}
                  className="step2-next-scene-card flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white/75 p-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-950/45"
                >
                  <span className="mt-0.5 font-mono text-xs text-muted-foreground w-6 shrink-0">
                    {i + 1}
                  </span>
                  {editSceneIdx === i ? (
                    <div className="flex-1 min-w-0 space-y-2">
                      <Input
                        value={tempScene.name ?? scene.name}
                        onChange={(e) => setTempScene((p) => ({ ...p, name: e.target.value }))}
                        placeholder="场景名称"
                        className="text-sm"
                      />
                      <Input
                        value={tempScene.environment ?? scene.environment}
                        onChange={(e) => setTempScene((p) => ({ ...p, environment: e.target.value }))}
                        placeholder="场景环境描述（建议写空间布局、关键陈设、材质、光源）"
                        className="text-sm"
                      />
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                          value={tempScene.timeOfDay ?? scene.timeOfDay ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, timeOfDay: e.target.value }))}
                          placeholder="时间段（如：白天 / 夜晚）"
                          className="text-sm"
                        />
                        <Input
                          value={tempScene.colorTone ?? scene.colorTone}
                          onChange={(e) => setTempScene((p) => ({ ...p, colorTone: e.target.value }))}
                          placeholder="色调（如：冷青灰、烛火暖金、高反差逆光）"
                          className="text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                          value={tempScene.layout ?? scene.layout ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, layout: e.target.value }))}
                          placeholder="空间布局 / 前中后景"
                          className="text-sm"
                        />
                        <Input
                          value={tempScene.lighting ?? scene.lighting ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, lighting: e.target.value }))}
                          placeholder="主光源 / 光线质感"
                          className="text-sm"
                        />
                        <Input
                          value={tempScene.keySetPieces ?? scene.keySetPieces ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, keySetPieces: e.target.value }))}
                          placeholder="关键陈设 / 地标"
                          className="text-sm"
                        />
                        <Input
                          value={tempScene.weather ?? scene.weather ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, weather: e.target.value }))}
                          placeholder="天气 / 烟雾 / 水汽"
                          className="text-sm"
                        />
                        <Input
                          value={tempScene.spaceScale ?? scene.spaceScale ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, spaceScale: e.target.value }))}
                          placeholder="空间尺度 / 景深层级"
                          className="text-sm"
                        />
                        <Input
                          value={tempScene.atmosphere ?? scene.atmosphere ?? ''}
                          onChange={(e) => setTempScene((p) => ({ ...p, atmosphere: e.target.value }))}
                          placeholder="氛围关键词 / 情绪质感"
                          className="text-sm"
                        />
                      </div>
                      <Textarea
                        value={tempScene.step3Description ?? scene.step3Description ?? ''}
                        onChange={(e) => setTempScene((p) => ({ ...p, step3Description: e.target.value }))}
                        placeholder="Step3 直用场景描述（整合环境、布局、灯光、天气、色调）"
                        className="min-h-[96px] text-sm"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveScene}><Check className="h-3.5 w-3.5 mr-1" />保存</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditSceneIdx(null)}><X className="h-3.5 w-3.5 mr-1" />取消</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      {(() => {
                        const sceneSuggestions = getSceneDetailSuggestions(scene);
                        const sceneInferredLabels = getSceneInferredFieldLabels(scene);
                        return (
                          <>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{scene.name}</span>
                        {scene.timeOfDay && (
                          <Badge
                            variant="outline"
                            className="step2-next-soft-chip text-xs"
                          >
                            {scene.timeOfDay}
                          </Badge>
                        )}
                        <button
                          onClick={() => startEditScene(i)}
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          title="编辑场景"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteScene(i)}
                          className="text-muted-foreground hover:text-red-500"
                          title="删除场景"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="step2-next-scene-environment mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-300">
                        {scene.environment}
                      </p>
                      {scene.step3Description && (
                        <details className="step2-next-scene-step3 mt-2 rounded-md bg-slate-100/80 p-2 text-xs leading-5 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                          <summary>
                            <span>Step3 生成描述</span>
                            <span className="step2-next-scene-step3-state">
                              <span>展开</span>
                              <span>收起</span>
                            </span>
                          </summary>
                          <p>{scene.step3Description}</p>
                        </details>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span
                          title={scene.colorTone || '未设置色调'}
                          className={`step2-next-soft-chip max-w-full rounded border px-1.5 py-0.5 text-xs leading-5 break-words ${
                            scene.colorTone?.includes('暖')
                              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200'
                                : scene.colorTone?.includes('冷')
                                ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-200'
                                : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {scene.colorTone || '未设置色调'}
                        </span>
                        {scene.characters.length > 0 && (
                          <span className="text-xs text-slate-500 dark:text-slate-300">
                            角色：{scene.characters.join('、')}
                          </span>
                        )}
                      </div>
                      {sceneSuggestions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {sceneSuggestions.map((suggestion) => (
                            <Badge
                              key={suggestion}
                              variant="outline"
                              className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]"
                            >
                              建议：{suggestion}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {sceneInferredLabels.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {sceneInferredLabels.map((label) => (
                            <Badge
                              key={label}
                              variant="outline"
                              className="step2-next-soft-chip step2-next-ai-chip text-[11px]"
                            >
                              AI 已补：{label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {/* 场景出现在哪些分镜 */}
                      {(() => {
                        const appearIn = analysis.storyboards
                          .filter((sb) => sb.scene === scene.name)
                          .map((sb) => String(sb.number).padStart(2, '0'));
                        if (appearIn.length > 0) {
                          return (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className="text-xs text-slate-500 dark:text-slate-300">出现分镜：</span>
                              {appearIn.map((n) => (
                                <Badge key={n} variant="secondary" className="step2-next-soft-chip step2-next-shot-chip h-5 px-1.5 py-0 text-xs">
                                  {n}
                                </Badge>
                              ))}
                            </div>
                          );
                        }
                        return (
                          <div className="mt-1.5">
                            <span className="text-xs text-amber-600 dark:text-amber-300">⚠️ 未被任何分镜引用</span>
                          </div>
                        );
                      })()}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              未识别到场景信息
            </p>
          )}
        </CardContent>
      </Card>
        </TabsContent>
  );
}

function CharactersTab(props: AnalysisResultTabsProps) {
  const {
    analysis,
    adaptedScript,
    isReviewFilterActive,
    reviewFilterLabel,
    visibleCharacterItems,
    editCharIdx,
    setEditCharIdx,
    tempChar,
    setTempChar,
    tempCharacterProfile,
    setTempCharacterProfile,
    startEditChar,
    saveChar,
    saveCharacterProfile,
    addChar,
    deleteChar,
  } = props;

  return (
        <TabsContent value="characters" className="mt-4">
      {/* 角色列表 */}
      <Card className="surface-panel border-white/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            👥 角色列表
            <Badge variant="secondary">
              {isReviewFilterActive ? `${visibleCharacterItems.length}/${analysis.allCharacterNames.length}` : analysis.allCharacterNames.length} 项
            </Badge>
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={addChar} title="添加角色">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {visibleCharacterItems.map(({ name, index: i }) => (
                  <div key={i} className="group flex min-w-0 items-center gap-1">
                {editCharIdx === i ? (
                  <>
                    <Input
                      value={tempChar}
                      onChange={(e) => setTempChar(e.target.value)}
                      className="h-7 w-32 text-sm"
                      onKeyDown={(e) => { if (e.key === 'Enter') saveChar(); if (e.key === 'Escape') setEditCharIdx(null); }}
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={saveChar}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setEditCharIdx(null)}><X className="h-3.5 w-3.5" /></Button>
                  </>
                ) : (
                  <>
                    <Badge
                      variant="outline"
                      className="step2-next-soft-chip max-w-full cursor-pointer whitespace-normal break-words px-3 py-1 text-sm [overflow-wrap:anywhere]"
                      onClick={() => startEditChar(i)}
                      title="点击编辑角色"
                    >
                      {name}
                      <span className="ml-1.5 text-xs opacity-60">
                        · 图片 {i + 2}
                      </span>
                    </Badge>
                    <button
                      onClick={() => deleteChar(i)}
                      className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除角色"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
            {analysis.allCharacterNames.length === 0 && (
              <p className="text-sm text-muted-foreground">
                未识别到角色
              </p>
            )}
            {analysis.allCharacterNames.length > 0 && visibleCharacterItems.length === 0 && (
              <div className="w-full rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                当前“{reviewFilterLabel}”筛选下没有角色项。
              </div>
            )}
          </div>
          {visibleCharacterItems.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {visibleCharacterItems.map(({ name }) => {
                const review = getCharacterReviewSummary({
                  characterName: name,
                  adaptedScript: adaptedScript,
                  outfits: analysis.outfitTracking,
                  characterProfiles: analysis.characterProfiles,
                });
                const sceneCount = analysis.scenes.filter((scene) => scene.characters?.includes(name)).length;
                const storyboardCount = analysis.storyboards.filter((storyboard) => storyboard.characters?.includes(name)).length;
                const isEditingProfile = editCharIdx !== null && analysis.allCharacterNames[editCharIdx] === name;
                return (
                  <div
                    key={`review-${name}`}
                    className="min-w-0 rounded-xl border border-slate-200/80 bg-white/70 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-950/45"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words font-medium text-slate-900 dark:text-slate-100 [overflow-wrap:anywhere]">{name}</span>
                      <Badge variant="outline" className="step2-next-soft-chip step2-next-shot-chip text-[11px]">
                        {storyboardCount} 个分镜
                      </Badge>
                      <Badge variant="outline" className="step2-next-soft-chip step2-next-shot-chip text-[11px]">
                        {sceneCount} 个场景
                      </Badge>
                    </div>
                    {isEditingProfile ? (
                      <div className="mt-2 space-y-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <Input
                            value={tempCharacterProfile.ageAppearance ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, ageAppearance: e.target.value }))}
                            className="text-sm"
                            placeholder="二十出头 / 三十岁上下"
                          />
                          <Input
                            value={tempCharacterProfile.temperament ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, temperament: e.target.value }))}
                            className="text-sm"
                            placeholder="清冷克制 / 张扬锐利"
                          />
                          <Input
                            value={tempCharacterProfile.skinTone ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, skinTone: e.target.value }))}
                            className="text-sm"
                            placeholder="冷白 / 小麦"
                          />
                          <Input
                            value={tempCharacterProfile.bodyBuild ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, bodyBuild: e.target.value }))}
                            className="text-sm"
                            placeholder="纤长 / 挺拔"
                          />
                          <Input
                            value={tempCharacterProfile.faceFeatures ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, faceFeatures: e.target.value }))}
                            className="text-sm"
                            placeholder="眉眼锋利 / 唇形清晰"
                          />
                          <Input
                            value={tempCharacterProfile.hairStyle ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, hairStyle: e.target.value }))}
                            className="text-sm"
                            placeholder="高束发 / 低挽髻"
                          />
                          <Input
                            value={tempCharacterProfile.defaultOutfit ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, defaultOutfit: e.target.value }))}
                            className="text-sm"
                            placeholder="月白中衣配暗金花纹外袍"
                          />
                          <Input
                            value={tempCharacterProfile.accessories ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, accessories: e.target.value }))}
                            className="text-sm"
                            placeholder="玉簪 / 耳坠 / 腰佩"
                          />
                          <Input
                            value={tempCharacterProfile.visualAnchor ?? ''}
                            onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, visualAnchor: e.target.value }))}
                            className="text-sm md:col-span-2"
                            placeholder="最容易认出她的视觉锚点"
                          />
                        </div>
                        <Textarea
                          value={tempCharacterProfile.description ?? ''}
                          onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, description: e.target.value }))}
                          className="min-h-[110px] text-sm"
                          placeholder="角色描述（发型发色、五官辨识点、服装锚点、气质、标志动作）"
                        />
                        <Textarea
                          value={tempCharacterProfile.step3Description ?? ''}
                          onChange={(e) => setTempCharacterProfile((prev) => ({ ...prev, step3Description: e.target.value }))}
                          className="min-h-[110px] text-sm"
                          placeholder="Step3 直用描述（不写剧情，只写年龄感、外观、服装、气质和视觉锚点）"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveCharacterProfile(name)}>
                            <Check className="h-3.5 w-3.5 mr-1" />保存角色描述
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditCharIdx(null)}>
                            <X className="h-3.5 w-3.5 mr-1" />取消
                          </Button>
                        </div>
                      </div>
                    ) : review.description ? (
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200 [overflow-wrap:anywhere]">
                        {review.description}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        这个角色还没有可直接给 Step3 复用的稳定外观描述，建议补一段清晰的年龄感、气质和视觉锚点。
                      </p>
                    )}
                    {review.step3Description && (
                      <p className="step2-next-note-panel mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-100/80 p-2 text-xs leading-5 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200 [overflow-wrap:anywhere]">
                        <span className="font-medium">Step3 描述：</span>
                        {review.step3Description}
                      </p>
                    )}
                    {review.metaChips.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {review.metaChips.map((chip) => (
                          <Badge key={chip} variant="outline" className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]">
                            {chip}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {review.inferredLabels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {review.inferredLabels.map((label) => (
                          <Badge
                            key={label}
                            variant="outline"
                            className="step2-next-soft-chip step2-next-ai-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]"
                          >
                            AI 已补：{label}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {review.primaryOutfit?.outfitDesc && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600 dark:text-slate-300 [overflow-wrap:anywhere]">
                        主要服装：{review.primaryOutfit.outfitDesc}
                      </p>
                    )}
                    {review.suggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {review.suggestions.map((suggestion) => (
                          <Badge
                            key={suggestion}
                            variant="outline"
                            className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]"
                          >
                            建议：{suggestion}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {!isEditingProfile && (
                      <div className="mt-2">
                        <Button size="sm" variant="outline" onClick={() => startEditChar(analysis.allCharacterNames.indexOf(name))}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />编辑角色描述
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
  );
}

function StoryboardsTab(props: AnalysisResultTabsProps) {
  const {
    analysis,
    adaptedScript,
    analysisSourceText,
    saveStoryboardSourceText,
    editSbIdx,
    setEditSbIdx,
    tempSb,
    setTempSb,
    startEditSb,
    saveSb,
    addStoryboard,
    deleteStoryboard,
  } = props;
  const storyboardSourceText = analysisSourceText || adaptedScript;

  return (
        <TabsContent value="storyboards" className="mt-4">
      {/* 分镜列表 */}
      <Card className="surface-panel border-white/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            🎬 分镜清单
            <Badge variant="secondary">
              {analysis.storyboards.length} 项
            </Badge>
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={addStoryboard} title="添加分镜">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.storyboards.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">分镜名</th>
                    <th className="py-2 pr-4">场景</th>
                    <th className="py-2 pr-4">时长</th>
                    <th className="py-2 pr-4">景别</th>
                    <th className="py-2">出场角色</th>
                    <th className="py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.storyboards.map((sb, i) => {
                    const sourceExcerpt = extractStoryboardSourceText(storyboardSourceText, sb.number);
                    const sourceDraft = tempSb.content ?? sourceExcerpt;
                    return (
                    <Fragment key={i}>
                    <tr className="border-b group">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {String(sb.number).padStart(2, '0')}
                      </td>
                      {editSbIdx === i ? (
                        <>
                          <td className="py-1 pr-4">
                            <Input
                              value={tempSb.name ?? sb.name}
                              onChange={(e) => setTempSb((p) => ({ ...p, name: e.target.value }))}
                              className="text-sm h-8"
                            />
                          </td>
                          <td className="py-1 pr-4">
                            <Select
                              value={tempSb.scene ?? sb.scene ?? ''}
                              onValueChange={(v) => setTempSb((p) => ({ ...p, scene: v }))}
                            >
                              <SelectTrigger className="text-sm h-8 w-32">
                                <SelectValue placeholder="选择场景" />
                              </SelectTrigger>
                              <SelectContent>
                                {analysis.scenes.map((s) => (
                                  <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-1 pr-4">
                            <Input
                              value={tempSb.duration ?? sb.duration}
                              onChange={(e) => setTempSb((p) => ({ ...p, duration: e.target.value }))}
                              className="text-sm h-8 w-24"
                              placeholder="如：15秒"
                            />
                          </td>
                          <td className="py-1 pr-4">
                            <Input
                              value={tempSb.shotSize ?? sb.shotSize}
                              onChange={(e) => setTempSb((p) => ({ ...p, shotSize: e.target.value }))}
                              className="text-sm h-8 w-24"
                              placeholder="如：特写"
                            />
                          </td>
                          <td className="py-1 pr-4">
                            <Input
                              value={(tempSb.characters ?? sb.characters).join('、')}
                              onChange={(e) =>
                                setTempSb((p) => ({
                                  ...p,
                                  characters: e.target.value.split('、').filter(Boolean),
                                }))
                              }
                              className="text-sm h-8"
                              placeholder="角色1、角色2"
                            />
                          </td>
                          <td className="py-1">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-8 px-1.5" onClick={saveSb}><Check className="h-3.5 w-3.5 text-green-600" /></Button>
                              <Button size="sm" variant="ghost" className="h-8 px-1.5" onClick={() => setEditSbIdx(null)}><X className="h-3.5 w-3.5 text-red-500" /></Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 pr-4 font-medium cursor-pointer hover:bg-muted/50" onClick={() => startEditSb(i)}>
                            {sb.name}
                          </td>
                          <td className="py-2 pr-4 cursor-pointer hover:bg-muted/50" onClick={() => startEditSb(i)}>
                            {sb.scene ? (
                              <Badge variant="outline" className="step2-next-soft-chip step2-next-shot-chip text-xs">{sb.scene}</Badge>
                            ) : (
                              <span className="text-xs text-amber-500">未指定</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 cursor-pointer hover:bg-muted/50" onClick={() => startEditSb(i)}>
                            {sb.duration}
                          </td>
                          <td className="py-2 pr-4 cursor-pointer hover:bg-muted/50" onClick={() => startEditSb(i)}>
                            {sb.shotSize}
                          </td>
                          <td className="py-2 text-muted-foreground cursor-pointer hover:bg-muted/50" onClick={() => startEditSb(i)}>
                            {sb.characters.join('、')}
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => startEditSb(i)}
                                className="text-muted-foreground hover:text-foreground"
                                title="编辑分镜"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => deleteStoryboard(i)}
                                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="删除分镜"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                    <tr className="step2-next-storyboard-detail-row border-b last:border-0">
                      <td colSpan={7} className="pb-3 pl-10 pr-2">
                        <details className="step2-next-storyboard-detail" open={editSbIdx === i || undefined}>
                          <summary>
                            <span>分镜内容 / 剧本原文</span>
                            <span className="step2-next-storyboard-detail-state"><span>查看/修改</span><span>收起</span></span>
                          </summary>
                          {editSbIdx === i ? (
                            <div className="step2-next-storyboard-editor">
                              <p className="is-source-label">编辑这条分镜在剧本里的原文内容。保存后会替换当前剧本对应分镜段。</p>
                              <Textarea
                                value={sourceDraft}
                                onChange={(e) => setTempSb((p) => ({ ...p, content: e.target.value }))}
                                className="min-h-[220px] text-sm"
                                placeholder="编辑这条分镜的剧本原文：标题、场景、画面、对白、音效、情绪等..."
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (saveStoryboardSourceText(sb.number, sourceDraft)) {
                                      saveSb();
                                    }
                                  }}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" />保存原文和结构
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditSbIdx(null)}><X className="mr-1 h-3.5 w-3.5" />取消</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="step2-next-storyboard-preview">
                              {sourceExcerpt ? (
                                <>
                                  <p className="is-source-label">当前剧本中的分镜原文：</p>
                                  <pre>{sourceExcerpt}</pre>
                                </>
                              ) : (
                                <p className="is-empty">暂无可匹配的分镜原文。点击右侧编辑按钮后，可以直接补写这条分镜原文。</p>
                              )}
                            </div>
                          )}
                        </details>
                      </td>
                    </tr>
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">
                💡 点击任意单元格即可编辑分镜信息，鼠标悬停显示删除按钮
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              未识别到分镜信息，请检查剧本格式
            </p>
          )}
        </CardContent>
      </Card>
        </TabsContent>
  );
}

function OutfitsTab(props: AnalysisResultTabsProps) {
  const {
    analysis,
    isReviewFilterActive,
    reviewFilterLabel,
    visibleOutfitItems,
    editOutfitIdx,
    setEditOutfitIdx,
    tempOutfit,
    setTempOutfit,
    startEditOutfit,
    saveOutfit,
    addOutfit,
    deleteOutfit,
  } = props;

  return (
        <TabsContent value="outfits" className="mt-4">
      {/* 变装追踪（如有） */}
        <Card className="surface-panel border-white/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              👔 角色变装追踪
              <Badge variant="secondary">
                {isReviewFilterActive ? `${visibleOutfitItems.length}/${analysis.outfitTracking.length}` : analysis.outfitTracking.length} 项
              </Badge>
              <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={addOutfit} title="新增变装">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analysis.outfitTracking.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">角色</th>
                    <th className="py-2 pr-4">服装</th>
                    <th className="py-2 pr-4">分镜范围</th>
                    <th className="py-2">状态</th>
                    <th className="py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOutfitItems.map(({ outfit, index: i }) => (
                    <tr key={i} className="border-b last:border-0 group align-top">
                      {editOutfitIdx === i ? (
                        <>
                          <td className="py-2 pr-4">
                            <div className="space-y-2">
                              <Select
                                value={tempOutfit.characterName ?? outfit.characterName}
                                onValueChange={(value) => setTempOutfit((prev) => ({
                                  ...prev,
                                  characterName: value,
                                  outfitSeq: prev.characterName === value
                                    ? prev.outfitSeq
                                    : getNextOutfitSeqForCharacter(analysis.outfitTracking, value),
                                }))}
                              >
                                <SelectTrigger className="h-8 text-sm w-32">
                                  <SelectValue placeholder="选择角色" />
                                </SelectTrigger>
                                <SelectContent>
                                  {analysis.allCharacterNames.map((characterName) => (
                                    <SelectItem key={characterName} value={characterName}>{characterName}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                min={1}
                                value={tempOutfit.outfitSeq ?? outfit.outfitSeq}
                                onChange={(e) => setTempOutfit((prev) => ({ ...prev, outfitSeq: Number(e.target.value) || 1 }))}
                                className="text-sm h-8 w-24"
                                placeholder="序号"
                              />
                            </div>
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              value={tempOutfit.outfitDesc ?? outfit.outfitDesc}
                              onChange={(e) => setTempOutfit((prev) => ({ ...prev, outfitDesc: e.target.value }))}
                              className="text-sm"
                              placeholder="服装描述（颜色、材质、层次、配饰）"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              value={tempOutfit.storyboardRange ?? outfit.storyboardRange}
                              onChange={(e) => setTempOutfit((prev) => ({ ...prev, storyboardRange: e.target.value }))}
                              className="text-sm h-8"
                              placeholder="分镜01-03"
                            />
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={tempOutfit.needsNewImage ?? outfit.needsNewImage}
                                onCheckedChange={(checked) => setTempOutfit((prev) => ({ ...prev, needsNewImage: checked }))}
                              />
                              <span className="text-xs text-muted-foreground">
                                {(tempOutfit.needsNewImage ?? outfit.needsNewImage) ? '需要生成新图' : '复用已有'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-8 px-1.5" onClick={saveOutfit}><Check className="h-3.5 w-3.5 text-green-600" /></Button>
                              <Button size="sm" variant="ghost" className="h-8 px-1.5" onClick={() => setEditOutfitIdx(null)}><X className="h-3.5 w-3.5 text-red-500" /></Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 pr-4 font-medium">
                            <div>{outfit.characterName}</div>
                            <p className="mt-1 text-xs text-muted-foreground">造型 #{outfit.outfitSeq}</p>
                          </td>
                          <td className="py-2 pr-4">
                            <p>{outfit.outfitDesc}</p>
                            {(() => {
                              const suggestions = getOutfitDetailSuggestions(outfit);
                              return suggestions.length > 0 ? (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {suggestions.map((suggestion) => (
                                    <Badge
                                      key={suggestion}
                                      variant="outline"
                                      className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]"
                                    >
                                      建议：{suggestion}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null;
                            })()}
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs">
                            {outfit.storyboardRange}
                          </td>
                          <td className="py-2">
                            <Badge
                              variant="outline"
                              className={`step2-next-soft-chip text-xs ${outfit.needsNewImage ? 'step2-next-ai-chip' : 'step2-next-shot-chip'}`}
                            >
                              {outfit.needsNewImage ? '需要生成新图' : '复用已有'}
                            </Badge>
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => startEditOutfit(i)}
                                className="text-muted-foreground hover:text-foreground"
                                title="编辑变装记录"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => deleteOutfit(i)}
                                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="删除变装记录"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleOutfitItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前“{reviewFilterLabel}”筛选下没有变装项。
                </div>
              )}
            </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                当前还没有变装记录。若 Step1 漏掉了造型变化，可以直接在这里手动补录。
              </div>
            )}
          </CardContent>
        </Card>
        </TabsContent>
  );
}

function PropsTab(props: AnalysisResultTabsProps) {
  const {
    analysis,
    isReviewFilterActive,
    reviewFilterLabel,
    visiblePropItems,
    editPropIdx,
    setEditPropIdx,
    tempProp,
    setTempProp,
    startEditProp,
    saveProp,
    addProp,
    deleteProp,
    togglePropNeedsTracking,
    togglePropNeedsImage,
  } = props;

  return (
        <TabsContent value="props" className="mt-4">
      {/* 物品/道具一致性追踪 */}
        <Card className="surface-panel border-white/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              🎒 物品/道具一致性追踪
              <Badge variant="secondary">
                {isReviewFilterActive ? `${visiblePropItems.length}/${analysis.propTracking.length}` : analysis.propTracking.length} 项
              </Badge>
              <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={addProp} title="新增道具">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analysis.propTracking.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-[13%] py-2 pr-4">物品名</th>
                    <th className="w-[34%] py-2 pr-4">外观描述</th>
                    <th className="w-[13%] py-2 pr-4">持有者</th>
                    <th className="w-[10%] py-2 pr-4">分镜范围</th>
                    <th className="w-[12%] py-2 pr-4">状态变化</th>
                    <th className="w-[8%] py-2 pr-4">连续性追踪</th>
                    <th className="w-[6%] py-2">参考图</th>
                    <th className="w-[4%] py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePropItems.map(({ prop, index: i }) => (
                    <tr key={i} className="border-b last:border-0 group align-top">
                      {editPropIdx === i ? (
                        <>
                          <td className="py-2 pr-4">
                            <Input
                              value={tempProp.propName ?? prop.propName}
                              onChange={(e) => setTempProp((prev) => ({ ...prev, propName: e.target.value }))}
                              className="text-sm h-8"
                              placeholder="道具名称"
                            />
                          </td>
                          <td className="py-2 pr-4 max-w-[420px]">
                            <div className="space-y-2">
                              <Textarea
                                value={tempProp.appearanceDesc ?? prop.appearanceDesc}
                                onChange={(e) => setTempProp((prev) => ({ ...prev, appearanceDesc: e.target.value }))}
                                className="min-h-[72px] text-sm"
                                placeholder="外观描述（颜色、材质、结构、纹样、光泽、新旧程度）"
                              />
                              <div className="grid gap-2 md:grid-cols-2">
                                <Input
                                  value={tempProp.size ?? prop.size ?? ''}
                                  onChange={(e) => setTempProp((prev) => ({ ...prev, size: e.target.value }))}
                                  className="text-sm h-8"
                                  placeholder="掌心大小 / 半人高"
                                />
                                <Input
                                  value={tempProp.material ?? prop.material ?? ''}
                                  onChange={(e) => setTempProp((prev) => ({ ...prev, material: e.target.value }))}
                                  className="text-sm h-8"
                                  placeholder="玉石 / 铜 / 木"
                                />
                                <Input
                                  value={tempProp.shapeStructure ?? prop.shapeStructure ?? ''}
                                  onChange={(e) => setTempProp((prev) => ({ ...prev, shapeStructure: e.target.value }))}
                                  className="text-sm h-8"
                                  placeholder="方形 / 长柄结构"
                                />
                                <Input
                                  value={tempProp.color ?? prop.color ?? ''}
                                  onChange={(e) => setTempProp((prev) => ({ ...prev, color: e.target.value }))}
                                  className="text-sm h-8"
                                  placeholder="墨黑 / 暗金"
                                />
                                <Input
                                  value={tempProp.texture ?? prop.texture ?? ''}
                                  onChange={(e) => setTempProp((prev) => ({ ...prev, texture: e.target.value }))}
                                  className="text-sm h-8"
                                  placeholder="冷润 / 粗粝 / 磨损"
                                />
                                <Input
                                  value={tempProp.condition ?? prop.condition ?? ''}
                                  onChange={(e) => setTempProp((prev) => ({ ...prev, condition: e.target.value }))}
                                  className="text-sm h-8"
                                  placeholder="完好 / 旧损 / 开裂"
                                />
                              </div>
                              <Input
                                value={tempProp.visualAnchor ?? prop.visualAnchor ?? ''}
                                onChange={(e) => setTempProp((prev) => ({ ...prev, visualAnchor: e.target.value }))}
                                className="text-sm h-8"
                                placeholder="最容易识别它的视觉锚点"
                              />
                              <Textarea
                                value={tempProp.step3Description ?? prop.step3Description ?? ''}
                                onChange={(e) => setTempProp((prev) => ({ ...prev, step3Description: e.target.value }))}
                                className="min-h-[92px] text-sm"
                                placeholder="Step3 直用描述（整合大小、材质、结构、颜色和质感，不写剧情）"
                              />
                            </div>
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              value={tempProp.holder ?? prop.holder}
                              onChange={(e) => setTempProp((prev) => ({ ...prev, holder: e.target.value }))}
                              className="text-sm h-8"
                              placeholder="持有者 / 场景道具"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              value={tempProp.storyboardRange ?? prop.storyboardRange}
                              onChange={(e) => {
                                const storyboardRange = e.target.value;
                                setTempProp((prev) => {
                                  const currentRange = prev.storyboardRange ?? prop.storyboardRange;
                                  const currentDefaults = getPropDefaultAssetFlags(currentRange);
                                  const currentNeedsTracking = prev.needsTracking ?? prop.needsTracking;
                                  const currentNeedsImage = prev.needsImage ?? prop.needsImage;
                                  const followsCurrentDefault = currentNeedsTracking === currentDefaults.needsTracking
                                    && currentNeedsImage === currentDefaults.needsImage;
                                  return {
                                    ...prev,
                                    storyboardRange,
                                    ...(followsCurrentDefault ? getPropDefaultAssetFlags(storyboardRange) : {}),
                                  };
                                });
                              }}
                              className="text-sm h-8"
                              placeholder="分镜01-05"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              value={tempProp.stateChanges ?? prop.stateChanges}
                              onChange={(e) => setTempProp((prev) => ({ ...prev, stateChanges: e.target.value }))}
                              className="text-sm h-8"
                              placeholder="完好→破损"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={tempProp.needsTracking ?? prop.needsTracking}
                                onCheckedChange={(checked) => setTempProp((prev) => ({ ...prev, needsTracking: checked, needsImage: checked ? (prev.needsImage ?? prop.needsImage) : false }))}
                              />
                              <span className="text-xs text-muted-foreground">
                                {(tempProp.needsTracking ?? prop.needsTracking) ? '需追踪' : '不追踪'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={tempProp.needsImage ?? prop.needsImage}
                                disabled={(tempProp.needsTracking ?? prop.needsTracking) === false}
                                onCheckedChange={(checked) => setTempProp((prev) => ({ ...prev, needsImage: checked }))}
                              />
                              <span className="text-xs text-muted-foreground">
                                {(tempProp.needsImage ?? prop.needsImage) ? '需要生成' : '不需要'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-8 px-1.5" onClick={saveProp}><Check className="h-3.5 w-3.5 text-green-600" /></Button>
                              <Button size="sm" variant="ghost" className="h-8 px-1.5" onClick={() => setEditPropIdx(null)}><X className="h-3.5 w-3.5 text-red-500" /></Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="min-w-0 py-2 pr-4 font-medium">
                            <span className="block whitespace-normal break-words [overflow-wrap:anywhere]">
                            {prop.propName}
                            </span>
                          </td>
                          <td className="min-w-0 py-2 pr-4">
                            <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]" title={prop.appearanceDesc}>
                              {prop.appearanceDesc || '-'}
                            </p>
                            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                              {prop.size && <Badge variant="outline" className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]">大小：{prop.size}</Badge>}
                              {prop.material && <Badge variant="outline" className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]">材质：{prop.material}</Badge>}
                              {prop.shapeStructure && <Badge variant="outline" className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]">结构：{prop.shapeStructure}</Badge>}
                              {prop.color && <Badge variant="outline" className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]">颜色：{prop.color}</Badge>}
                              {prop.condition && <Badge variant="outline" className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]">状态：{prop.condition}</Badge>}
                            </div>
                            {prop.step3Description && (
                              <p className="step2-next-note-panel mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-100/80 p-2 text-xs leading-5 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200 [overflow-wrap:anywhere]">
                                <span className="font-medium">Step3 描述：</span>
                                {prop.step3Description}
                              </p>
                            )}
                            {(() => {
                              const suggestions = getPropDetailSuggestions(prop);
                              const inferredLabels = getPropInferredFieldLabels(prop);
                              return (suggestions.length > 0 || inferredLabels.length > 0) ? (
                                <>
                                  {suggestions.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {suggestions.map((suggestion) => (
                                        <Badge
                                          key={suggestion}
                                          variant="outline"
                                          className="step2-next-soft-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]"
                                        >
                                          建议：{suggestion}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {inferredLabels.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {inferredLabels.map((label) => (
                                        <Badge
                                          key={label}
                                          variant="outline"
                                          className="step2-next-soft-chip step2-next-ai-chip max-w-full whitespace-normal break-words text-[11px] [overflow-wrap:anywhere]"
                                        >
                                          AI 已补：{label}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </>
                              ) : null;
                            })()}
                          </td>
                          <td className="min-w-0 py-2 pr-4">
                            <Badge variant="outline" className="step2-next-soft-chip step2-next-shot-chip max-w-full whitespace-normal break-words text-xs [overflow-wrap:anywhere]">
                              {prop.holder || '未指定'}
                            </Badge>
                          </td>
                          <td className="min-w-0 py-2 pr-4 font-mono text-xs break-words [overflow-wrap:anywhere]">
                            {prop.storyboardRange}
                          </td>
                          <td className="min-w-0 py-2 pr-4">
                            {prop.stateChanges ? (
                              <span className="block whitespace-normal break-words text-xs text-amber-600 dark:text-amber-400 [overflow-wrap:anywhere]">
                                {prop.stateChanges}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">无变化</span>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={prop.needsTracking !== false}
                                onCheckedChange={(checked) => togglePropNeedsTracking(i, checked)}
                                aria-label={`切换 ${prop.propName} 的连续性追踪`}
                              />
                              <span className="text-xs text-muted-foreground">
                                {prop.needsTracking === false ? '不追踪' : '需追踪'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={prop.needsImage}
                                disabled={prop.needsTracking === false}
                                onCheckedChange={(checked) => togglePropNeedsImage(i, checked)}
                                aria-label={`切换 ${prop.propName} 的参考图生成`}
                              />
                              <span className="text-xs text-muted-foreground">
                                {prop.needsImage ? '需要生成' : '不需要'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => startEditProp(i)}
                                className="text-muted-foreground hover:text-foreground"
                                title="编辑道具记录"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => deleteProp(i)}
                                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="删除道具记录"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visiblePropItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前“{reviewFilterLabel}”筛选下没有道具项。
                </div>
              )}
            </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                当前还没有道具追踪记录。若 Step1 漏掉了关键物品，可以直接在这里手动新增。
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              提示：默认只有跨多个分镜出现的物品会开启“需追踪”和“需要生成”；单镜头道具默认不进参考图资产池，可按需要手动打开。
            </p>
          </CardContent>
        </Card>
        </TabsContent>
  );
}

export function AnalysisResultTabs(props: AnalysisResultTabsProps) {
  const { analysis } = props;

  return (
      <Tabs defaultValue="scenes" className="w-full">
        <TabsList className="step2-next-section-tabs sticky top-2 z-20 h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-white/60 bg-background/90 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <TabsTrigger value="scenes" className="step2-next-section-tab rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">📍 场景 <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{analysis.scenes.length}</Badge></TabsTrigger>
          <TabsTrigger value="characters" className="step2-next-section-tab rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">👥 角色 <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{analysis.allCharacterNames.length}</Badge></TabsTrigger>
          <TabsTrigger value="storyboards" className="step2-next-section-tab rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">🎬 分镜 <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{analysis.storyboards.length}</Badge></TabsTrigger>
          <TabsTrigger value="outfits" className="step2-next-section-tab rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">👔 变装 <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{analysis.outfitTracking.length}</Badge></TabsTrigger>
          <TabsTrigger value="props" className="step2-next-section-tab rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">🎒 道具 <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{analysis.propTracking.length}</Badge></TabsTrigger>
        </TabsList>

        <ScenesTab {...props} />
        <CharactersTab {...props} />
        <StoryboardsTab {...props} />
        <OutfitsTab {...props} />
        <PropsTab {...props} />
      </Tabs>
  );
}
