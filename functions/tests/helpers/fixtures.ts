import type { FrameworkPlan } from '../../src/contracts/framework';

// Synthetic document text (示例). Sentences are 12-180 chars so they become evidence segments.
export const SAMPLE_TEXT = [
  '医用呼吸机压力传感器技术要求（示例）',
  '第一章 项目背景与必要性',
  '当前国产医用呼吸机压力传感器依赖进口，供应链风险较高，需要制定统一的技术要求。',
  '本标准规定了压力传感器的测量范围为 0～10 kPa，准确度优于 1%，响应时间不超过 20 ms。',
  '第二章 主要技术内容',
  '标准制定过程包括立项、起草、征求意见和送审四个阶段，历时 18 个月。',
  '试验方法采用标准压力源比对，环境温度 23 ℃，相对湿度 50%。',
  '产业链上游为敏感元件，中游为传感器封装，下游为整机厂商与医院。',
].join('\n');

export function twoChapterPlan(): FrameworkPlan {
  return {
    presetId: 'standard_review',
    coverInfo: { standardName: '医用呼吸机压力传感器技术要求（示例）', presenter: '张三（示例）', date: '2026-10-03' },
    chapters: [
      {
        chapterIndex: 1,
        chapterTitle: '一、项目背景与必要性',
        slides: [
          { subtitle: '项目背景', visualMode: 'table', contentHint: '背景与依据' },
          { subtitle: '必要性分析', visualMode: 'images', contentHint: '产业链风险' },
        ],
      },
      {
        chapterIndex: 2,
        chapterTitle: '二、主要技术内容',
        slides: [
          { subtitle: '技术指标', visualMode: 'table', contentHint: '测量范围与准确度' },
          { subtitle: '制定过程', visualMode: 'images', contentHint: '阶段与时间' },
        ],
      },
    ],
    endingInfo: { organization: '机械工业仪器仪表综合技术经济研究所' },
  };
}

export const FIXED_NOW = new Date('2026-10-03T08:00:00.000Z');
