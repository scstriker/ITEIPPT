import type { SlideContent } from '../../types/analyzer';

// 1x1 transparent PNG.
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function pngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(PNG_1X1_BASE64, 'base64'));
}

const SECTION_ITEMS = [
  '一、项目背景及必要性',
  '二、适用范围及主要内容',
  '三、制定过程',
  '四、主要技术指标',
  '五、产业链与效益',
  '六、结论与建议',
].map((title, index) => ({ number: String(index + 1).padStart(2, '0'), title }));

// Covers every renderer branch: cover, toc, content (table / two images / single image /
// prompt placeholder with one and two prompts / text only with a long subtitle), ending.
export function renderFixtureSlides(): SlideContent[] {
  return [
    {
      page: 1,
      type: 'cover',
      standardName: '医用呼吸机关键零部件 第1部分：压力传感器（示例）',
      planNumber: 'T/ITEI 2026-001',
      reportTitle: '团体标准送审稿审查汇报',
      presenter: '张三（示例）',
      date: '2026-10-03',
      organization: '机械工业仪器仪表综合技术经济研究所',
    },
    {
      page: 2,
      type: 'toc_section',
      pageTitle: '汇报内容',
      highlightChapter: 2,
      sectionItems: SECTION_ITEMS,
    },
    {
      page: 3,
      type: 'content',
      chapterTitle: '一、项目背景及必要性',
      subtitle: '项目背景及意义',
      bodyText:
        '本标准是工作组的第一项术语标准。旨在统一医疗装备产业与应用领域的术语和定义，为研发、生产、使用和服务提供通用语言基础。',
      highlightRanges: [
        [8, 11],
        [20, 40],
      ],
      visualMode: 'table',
      tableData: {
        headers: ['政策文件', '发布机构', '核心要求'],
        rows: [
          ['《医疗装备产业发展规划》（示例）', '工信部', '完善标准体系'],
          ['《医疗器械监督管理条例》（示例）', '国务院', '支持基础研究'],
        ],
      },
    },
    {
      page: 4,
      type: 'content',
      chapterTitle: '一、项目背景及必要性',
      subtitle: '必要性分析',
      bodyText: '压力传感器依赖进口，供应链风险较高，需要统一技术要求。',
      highlightRanges: [[0, 7]],
      visualMode: 'images',
      imagePrompts: [
        { description: '产业链示意', iteiDrawPrompt: 'supply chain diagram' },
        { description: '风险示意', iteiDrawPrompt: 'risk matrix diagram' },
      ],
      images: [
        { key: 'page-4-slot-0', mimeType: 'image/png' },
        { key: 'page-4-slot-1', mimeType: 'image/png' },
      ],
      imageFiles: ['page-4-slot-0', 'page-4-slot-1'],
    },
    {
      page: 5,
      type: 'content',
      chapterTitle: '二、适用范围及主要内容',
      subtitle: '适用范围',
      bodyText: '本标准适用于医用呼吸机用压力传感器的设计、生产和检验。',
      visualMode: 'images',
      imagePrompts: [{ description: '适用范围图', iteiDrawPrompt: 'scope diagram of ventilator sensors' }],
      images: [{ key: 'page-5-slot-0', mimeType: 'image/png' }],
      imageFiles: ['page-5-slot-0'],
    },
    {
      page: 6,
      type: 'content',
      chapterTitle: '三、制定过程',
      subtitle: '制定过程',
      bodyText: '标准制定经历立项、起草、征求意见和送审四个阶段。',
      visualMode: 'images',
      imagePrompts: [{ description: '流程图', iteiDrawPrompt: 'standard drafting timeline' }],
    },
    {
      page: 7,
      type: 'content',
      chapterTitle: '三、制定过程',
      subtitle: '论证过程',
      bodyText: '工作组组织了三次专家论证会。',
      visualMode: 'images',
      imagePrompts: [
        { description: '会议照片', iteiDrawPrompt: 'expert meeting' },
        { description: '论证结论', iteiDrawPrompt: 'conclusion board' },
      ],
    },
    {
      page: 8,
      type: 'content',
      chapterTitle: '四、主要技术指标',
      subtitle: '测量范围、准确度、响应时间与长期稳定性的综合技术要求说明',
      bodyText: '测量范围 0～10 kPa，准确度优于 1%，响应时间不超过 20 ms，年漂移小于 0.5%。',
      highlightRanges: [[0, 12]],
      visualMode: 'none',
    },
    {
      page: 9,
      type: 'ending',
      thanks: '敬请指正',
      organization: '机械工业仪器仪表综合技术经济研究所',
      contactInfo: ['地址：北京市西城区（示例）', '电话：010-00000000（示例）'],
    },
  ];
}
