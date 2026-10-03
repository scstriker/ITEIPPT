// AC-008 ~ AC-011, AC-013 ~ AC-015: framework editing rules and the stored job record.
import { describe, expect, it } from 'vitest';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { FrameworkPlan } from '@contracts/framework';
import {
  appendChapter,
  appendSubSlide,
  applyPreset,
  coverageSummaryText,
  degradedWarning,
  estimateTotalPages,
  getProgressStageText,
  mergeInsights,
  removeChapter,
  resizeSlides,
  validatePlanBeforeGenerate,
} from '../features/framework/frameworkEditing';
import {
  ACTIVE_GENERATION_JOB_KEY,
  clearStoredGenerationJob,
  readStoredGenerationJob,
  writeStoredGenerationJob,
} from '../features/framework/useGenerationJob';
import { createFrameworkPlanFromPreset } from '../template/presets';

function academic(): FrameworkPlan {
  return { ...createFrameworkPlanFromPreset('academic_research'), coverInfo: { standardName: '标题' }, endingInfo: { organization: '机构' } };
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('presets and page estimate', () => {
  it('academic preset has 4 chapters and 14 pages', () => {
    const plan = academic();
    expect(plan.chapters.map((c) => c.chapterTitle)[0]).toBe('一、研究背景与意义');
    expect(estimateTotalPages(plan)).toBe(14);
  });

  it('switching preset keeps cover and ending info', () => {
    const blank = applyPreset(academic(), 'blank');
    expect(blank.chapters).toEqual([]);
    expect(blank.coverInfo).toEqual({ standardName: '标题' });
    expect(blank.endingInfo).toEqual({ organization: '机构' });
  });
});

describe('chapter and sub-chapter editing', () => {
  it('appends a chapter with one sub-chapter and renumbers after removal', () => {
    const added = appendChapter(academic());
    expect(added.chapters[4]).toMatchObject({ chapterIndex: 5, chapterTitle: '第5章', slides: [{ subtitle: '新子章节', visualMode: 'none' }] });
    const removed = removeChapter(added, 0);
    expect(removed.chapters.map((c) => c.chapterIndex)).toEqual([1, 2, 3, 4]);
    expect(removed.chapters[0].chapterTitle).toBe('二、研究方法');
  });

  it('resizes sub-chapters within 1..20, copying the last layout', () => {
    const slides = academic().chapters[1].slides;
    expect(resizeSlides(slides, 3)[2]).toEqual({ subtitle: '子章节 3', visualMode: 'images', contentHint: '实验流程图与数据采集方式。' });
    expect(resizeSlides(slides, 0)).toHaveLength(1);
    expect(resizeSlides(slides, 25)).toHaveLength(20);
    expect(resizeSlides(slides, Number.NaN)).toHaveLength(1);
    expect(appendSubSlide(academic(), 0).chapters[0].slides[2]).toEqual({ subtitle: '子章节 3', visualMode: 'none', contentHint: '待补充' });
  });

  it('validates titles before generating', () => {
    const plan = academic();
    expect(validatePlanBeforeGenerate(plan)).toBeNull();
    expect(validatePlanBeforeGenerate({ ...plan, chapters: [] })).toBe('请至少保留 1 个章节。');
    plan.chapters[0].chapterTitle = ' ';
    expect(validatePlanBeforeGenerate(plan)).toBe('第 1 章标题不能为空。');
    plan.chapters[0].chapterTitle = 'x';
    plan.chapters[1].slides[1].subtitle = '';
    expect(validatePlanBeforeGenerate(plan)).toBe('第 2-2 子章节标题不能为空。');
  });
});

describe('AI suggestions', () => {
  it('takes AI chapters only when the plan is empty', () => {
    const ai = academic();
    expect(mergeInsights(applyPreset(ai, 'blank'), ai).chapters).toHaveLength(4);
  });

  it('keeps names and applies reasons, coverage and slide layouts', () => {
    const current = academic();
    const ai: FrameworkPlan = {
      ...current,
      chapters: current.chapters.map((c) => ({ ...c, chapterTitle: 'AI 改名', aiReason: `理由${c.chapterIndex}`, coverageLevel: 'sparse' })),
      apiPlanMeta: { slideInsights: [{ chapterIndex: 1, slideIndex: 2, visualMode: 'images', reason: 'r' }] },
    };
    const merged = mergeInsights(current, ai);
    expect(merged.chapters[0].chapterTitle).toBe('一、研究背景与意义');
    expect(merged.chapters[0].aiReason).toBe('理由1');
    expect(merged.chapters[0].slides.map((s) => s.visualMode)).toEqual(['none', 'images']);
    expect(coverageSummaryText(merged)).toBe('章节覆盖评估：高覆盖 0 / 中覆盖 0 / 低覆盖 4');
    expect(coverageSummaryText(current)).toBe('章节覆盖评估：待 AI 建议调整后生成');
  });
});

describe('generation feedback', () => {
  it('maps progress to stage text', () => {
    expect([0, 20, 50, 70, 90, 100].map(getProgressStageText)).toEqual([
      '正在建立章节语义索引',
      '正在提炼子章节内容',
      '正在匹配布局提示',
      '正在生成逐页内容草稿',
      '正在校验一致性与完整性',
      '已完成，结果已就绪',
    ]);
  });

  it('only warns about technical degrade reasons', () => {
    const result = (reason?: string) => ({ generationMeta: { mode: 'degraded', reason } }) as AnalyzerResult;
    expect(degradedWarning(result('batch_generation_failed;soft_deadline_reached'), true)).toBe(
      '已降级生成，可继续编辑（原因：batch_generation_failed;soft_deadline_reached）。',
    );
    expect(degradedWarning(result('other'), true)).toBeNull();
    expect(degradedWarning(result(undefined), true)).toBe('已降级生成，可继续编辑。');
    expect(degradedWarning(result('batch_generation_failed'), false)).toBeNull();
  });
});

describe('stored job record', () => {
  it('round-trips and rejects broken records', () => {
    const store = new MemoryStorage();
    writeStoredGenerationJob({ jobId: 'job-1', planDigest: 'd', savedAt: 't' }, store);
    expect(readStoredGenerationJob(store)).toEqual({ jobId: 'job-1', planDigest: 'd', savedAt: 't' });
    store.setItem(ACTIVE_GENERATION_JOB_KEY, '{"jobId":" ","planDigest":"d"}');
    expect(readStoredGenerationJob(store)).toBeNull();
    store.setItem(ACTIVE_GENERATION_JOB_KEY, 'not json');
    expect(readStoredGenerationJob(store)).toBeNull();
    clearStoredGenerationJob(store);
    expect(store.getItem(ACTIVE_GENERATION_JOB_KEY)).toBeNull();
  });
});
