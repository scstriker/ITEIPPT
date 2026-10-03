import { getTemplate } from './templateLoader';
import type { ChapterPlan, FrameworkPlan, PresetChapter, TemplatePreset } from '../types/framework';
import type { SlideInstance, TemplateElementItem, TemplateShape, VisualMode } from '../types/template';

const CHAPTER_TITLE_PATTERN = /^(?:第[一二三四五六七八九十0-9]+章|[一二三四五六七八九十]+、)/;
const BODY_TEXT_PATTERN = /^(?:本标准|本报告|本页)/;

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function collectShapeTexts(shapes: TemplateShape[] | undefined): string[] {
  if (!shapes?.length) {
    return [];
  }

  const texts: string[] = [];
  const walk = (items: TemplateShape[]) => {
    for (const shape of items) {
      const text = trimText(shape.text_frame?.text);
      if (text) {
        texts.push(text);
      }
      for (const paragraph of shape.text_frame?.paragraphs ?? []) {
        if (typeof paragraph === 'string') {
          const paragraphText = trimText(paragraph);
          if (paragraphText) {
            texts.push(paragraphText);
          }
          continue;
        }
        const paragraphText = trimText(paragraph.text);
        if (paragraphText) {
          texts.push(paragraphText);
        }
        for (const run of paragraph.runs ?? []) {
          if (typeof run === 'string') {
            const runText = trimText(run);
            if (runText) {
              texts.push(runText);
            }
            continue;
          }
          const runText = trimText(run.text);
          if (runText) {
            texts.push(runText);
          }
        }
      }
      if (shape.children?.length) {
        walk(shape.children);
      }
    }
  };

  walk(shapes);
  return unique(texts);
}

function extractTocTitles(): string[] {
  const template = getTemplate();
  const sectionItems = template.slide_types.toc_section.elements.find((item) => item.role === 'section_items');
  if (!sectionItems?.items?.length) {
    return [];
  }
  return sectionItems.items.map((item: TemplateElementItem) => trimText(item.title || item.text)).filter(Boolean);
}

function extractContentTitle(slide: SlideInstance): { chapterTitle?: string; subtitle?: string } {
  const texts = collectShapeTexts(slide.shapes);
  if (!texts.length) {
    return {};
  }

  const chapterTitle = texts.find((text) => CHAPTER_TITLE_PATTERN.test(text));
  const subtitle = texts.find((text) => {
    if (!text || text === chapterTitle) {
      return false;
    }
    if (text === '汇报内容') {
      return false;
    }
    if (CHAPTER_TITLE_PATTERN.test(text)) {
      return false;
    }
    if (BODY_TEXT_PATTERN.test(text)) {
      return false;
    }
    if (text.length > 30) {
      return false;
    }
    if (/^\d+$/.test(text)) {
      return false;
    }
    return true;
  });

  return { chapterTitle, subtitle };
}

function toPresetChapter(slides: SlideInstance[]): PresetChapter[] {
  const tocTitles = extractTocTitles();
  const chapters: PresetChapter[] = [];
  let chapterCursor = -1;

  for (const slide of slides) {
    if (slide.slide_type === 'toc_section') {
      chapterCursor += 1;
      if (!chapters[chapterCursor]) {
        chapters[chapterCursor] = {
          title: tocTitles[chapterCursor] || `第${chapterCursor + 1}章`,
          defaultSubtitles: [],
        };
      }
      continue;
    }

    if (slide.slide_type !== 'content') {
      continue;
    }

    if (chapterCursor < 0) {
      chapterCursor = 0;
    }

    if (!chapters[chapterCursor]) {
      chapters[chapterCursor] = {
        title: tocTitles[chapterCursor] || `第${chapterCursor + 1}章`,
        defaultSubtitles: [],
      };
    }

    const inferred = extractContentTitle(slide);
    const chapter = chapters[chapterCursor];
    if ((!chapter.title || chapter.title.startsWith('第')) && inferred.chapterTitle) {
      chapter.title = inferred.chapterTitle;
    }

    const subtitle = inferred.subtitle || `内容页 ${chapter.defaultSubtitles.length + 1}`;
    chapter.defaultSubtitles.push({
      subtitle,
      visualMode: (slide.visual_mode ?? 'none') as VisualMode,
      contentHint: `基于模板第 ${slide.slide_number} 页默认结构`,
    });
  }

  return chapters.filter((chapter) => chapter.defaultSubtitles.length > 0);
}

function buildStandardReviewChapters(): PresetChapter[] {
  const template = getTemplate();
  const orderedSlides = [...template.slides].sort((a, b) => a.slide_number - b.slide_number);
  const fromTemplate = toPresetChapter(orderedSlides);
  if (fromTemplate.length) {
    return fromTemplate;
  }

  return [
    {
      title: '一、项目背景及必要性',
      defaultSubtitles: [{ subtitle: '项目背景及意义', visualMode: 'table', contentHint: '背景说明与政策依据。' }],
    },
  ];
}

const STANDARD_REVIEW_PRESET: TemplatePreset = {
  id: 'standard_review',
  name: '标准审查汇报',
  description: '团体标准/国家标准送审稿审查汇报，强调制定过程与技术内容审查。',
  chapters: buildStandardReviewChapters(),
};

const ACADEMIC_RESEARCH_PRESET: TemplatePreset = {
  id: 'academic_research',
  name: '学术研究汇报',
  description: '学术论文或课题研究答辩汇报，强调方法、结果、讨论与结论。',
  chapters: [
    {
      title: '一、研究背景与意义',
      defaultSubtitles: [
        { subtitle: '研究背景', visualMode: 'none', contentHint: '说明研究动机与问题定义。' },
        { subtitle: '研究意义', visualMode: 'none', contentHint: '解释理论价值与应用价值。' },
      ],
    },
    {
      title: '二、研究方法',
      defaultSubtitles: [
        { subtitle: '研究设计', visualMode: 'table', contentHint: '方法流程、样本与变量定义。' },
        { subtitle: '实验与数据来源', visualMode: 'images', contentHint: '实验流程图与数据采集方式。' },
      ],
    },
    {
      title: '三、主要结果与讨论',
      defaultSubtitles: [
        { subtitle: '核心结果', visualMode: 'table', contentHint: '关键结果表格与统计结论。' },
        { subtitle: '结果解读', visualMode: 'none', contentHint: '讨论结果意义与局限性。' },
      ],
    },
    {
      title: '四、结论与展望',
      defaultSubtitles: [
        { subtitle: '研究结论', visualMode: 'none', contentHint: '总结结论并回答研究问题。' },
        { subtitle: '未来工作', visualMode: 'none', contentHint: '提出后续研究方向。' },
      ],
    },
  ],
};

const BLANK_PRESET: TemplatePreset = {
  id: 'blank',
  name: '自定义',
  description: '任意主题，从零开始自定义章节与子章节结构。',
  chapters: [],
};

const PRESETS: TemplatePreset[] = [STANDARD_REVIEW_PRESET, ACADEMIC_RESEARCH_PRESET, BLANK_PRESET];

function clonePreset(preset: TemplatePreset): TemplatePreset {
  return {
    ...preset,
    chapters: preset.chapters.map((chapter) => ({
      ...chapter,
      defaultSubtitles: chapter.defaultSubtitles.map((sub) => ({ ...sub })),
    })),
  };
}

export function getTemplatePresets(): TemplatePreset[] {
  return PRESETS.map(clonePreset);
}

export function reindexChapters(chapters: ChapterPlan[]): ChapterPlan[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    chapterIndex: index + 1,
  }));
}

export function createFrameworkPlanFromPreset(presetId: TemplatePreset['id']): FrameworkPlan {
  const presets = getTemplatePresets();
  const preset = presets.find((item) => item.id === presetId) ?? presets[0];

  return {
    presetId: preset.id,
    coverInfo: {},
    chapters: reindexChapters(
      preset.chapters.map((chapter, index) => ({
        chapterIndex: index + 1,
        chapterTitle: chapter.title,
        slides: chapter.defaultSubtitles.map((sub) => ({
          subtitle: sub.subtitle,
          visualMode: sub.visualMode,
          contentHint: sub.contentHint,
        })),
      })),
    ),
    endingInfo: {},
    apiPlanMeta: {
      chapterInsights: [],
      slideInsights: [],
    },
  };
}
