import type { ChapterPlan, FrameworkPlan, TemplatePreset } from '../contracts/framework';

function createStandardReviewChapters(): ChapterPlan[] {
  return [
    {
      chapterIndex: 1,
      chapterTitle: '一、项目背景与目标',
      slides: [
        { subtitle: '背景与建设必要性', visualMode: 'table', contentHint: '说明现状问题、建设必要性与目标边界。' },
        { subtitle: '目标与范围定义', visualMode: 'table', contentHint: '明确建设目标、范围与验收口径。' },
      ],
    },
    {
      chapterIndex: 2,
      chapterTitle: '二、现状资源盘点',
      slides: [
        { subtitle: '硬件资源盘点', visualMode: 'table', contentHint: '梳理服务器、算力、存储等硬件资源。' },
        { subtitle: '软件与数据资源盘点', visualMode: 'table', contentHint: '梳理软件资产、数据资产与能力现状。' },
      ],
    },
    {
      chapterIndex: 3,
      chapterTitle: '三、关键问题分析',
      slides: [
        { subtitle: '痛点与风险', visualMode: 'images', contentHint: '识别当前瓶颈、风险与影响。' },
        { subtitle: '原因归因', visualMode: 'table', contentHint: '从组织、流程、技术层面归因。' },
      ],
    },
    {
      chapterIndex: 4,
      chapterTitle: '四、方案设计',
      slides: [
        { subtitle: '总体方案与架构', visualMode: 'images', contentHint: '给出总体技术架构与关键模块。' },
        { subtitle: '方案对比与选型', visualMode: 'table', contentHint: '对比候选方案并给出选型依据。' },
      ],
    },
    {
      chapterIndex: 5,
      chapterTitle: '五、实施路径',
      slides: [
        { subtitle: '阶段计划与里程碑', visualMode: 'table', contentHint: '分阶段路线、里程碑与交付物。' },
        { subtitle: '资源投入与保障', visualMode: 'table', contentHint: '人员、预算、制度与保障机制。' },
      ],
    },
    {
      chapterIndex: 6,
      chapterTitle: '六、结论与建议',
      slides: [
        { subtitle: '结论摘要', visualMode: 'table', contentHint: '总结核心结论。' },
        { subtitle: '下一步建议', visualMode: 'images', contentHint: '提出后续行动建议与优先级。' },
      ],
    },
  ];
}

function createAcademicResearchChapters(): ChapterPlan[] {
  return [
    {
      chapterIndex: 1,
      chapterTitle: '一、研究背景与意义',
      slides: [
        { subtitle: '研究背景', visualMode: 'table', contentHint: '说明研究动机与问题定义。' },
        { subtitle: '研究意义', visualMode: 'table', contentHint: '说明理论与应用价值。' },
      ],
    },
    {
      chapterIndex: 2,
      chapterTitle: '二、研究方法',
      slides: [
        { subtitle: '研究设计', visualMode: 'table', contentHint: '介绍方法框架与变量定义。' },
        { subtitle: '实验与数据来源', visualMode: 'images', contentHint: '说明实验流程与数据来源。' },
      ],
    },
    {
      chapterIndex: 3,
      chapterTitle: '三、结果与讨论',
      slides: [
        { subtitle: '核心结果', visualMode: 'table', contentHint: '展示关键实验结果与指标。' },
        { subtitle: '结果解读', visualMode: 'table', contentHint: '解释结果意义与局限。' },
      ],
    },
    {
      chapterIndex: 4,
      chapterTitle: '四、结论与展望',
      slides: [
        { subtitle: '研究结论', visualMode: 'table', contentHint: '总结结论并回应研究问题。' },
        { subtitle: '未来工作', visualMode: 'images', contentHint: '提出后续研究方向。' },
      ],
    },
  ];
}

export function createFrameworkPlanFromPreset(presetId: TemplatePreset['id']): FrameworkPlan {
  const chapters =
    presetId === 'standard_review'
      ? createStandardReviewChapters()
      : presetId === 'academic_research'
        ? createAcademicResearchChapters()
        : [];

  return {
    presetId,
    coverInfo: {},
    chapters,
    endingInfo: {},
    apiPlanMeta: {
      chapterInsights: [],
      slideInsights: [],
    },
  };
}
