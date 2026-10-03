// AC-002 / AC-004: upload validation and document summary.
import { describe, expect, it } from 'vitest';
import { buildSummary, clampTargetSlides, formatSizeKb, validateSelection } from '../features/upload/uploadRules';

function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name);
}

describe('upload rules', () => {
  it('accepts one pdf or docx up to 20 MB', () => {
    expect(validateSelection([file('a.PDF')])).toBeNull();
    expect(validateSelection([file('a.docx', 20 * 1024 * 1024)])).toBeNull();
  });

  it('rejects in the UI order: count, extension, size', () => {
    expect(validateSelection([file('a.txt'), file('b.pdf')])).toBe('一次仅支持上传一个文件，请重新选择。');
    expect(validateSelection([file('a.doc')])).toBe('文件格式不支持，仅允许 .pdf / .docx。');
    expect(validateSelection([file('a.pdf', 20 * 1024 * 1024 + 1)])).toBe('文件过大，请上传不超过 20MB 的文档。');
  });

  it('formats size and clamps the target page count', () => {
    expect(formatSizeKb(4467.2 * 1024)).toBe('4467.2 KB');
    expect([clampTargetSlides(2), clampTargetSlides(Number.NaN), clampTargetSlides(30)]).toEqual([4, 4, 30]);
  });

  it('summarises the parsed document', () => {
    expect(buildSummary(null).title).toBe('待上传文档');
    const summary = buildSummary({
      filename: '送审稿（示例）.docx',
      fileType: 'docx',
      textContent: '\n  压力传感器技术要求（示例）\n测量范围，准确度。响应时间 稳定性\n',
    });
    expect(summary).toEqual({
      title: '压力传感器技术要求（示例）',
      domain: 'DOCX',
      keywords: '测量范围、准确度、响应时间、稳定性',
      abstract: '\n  压力传感器技术要求（示例）\n测量范围，准确度。响应时间 稳定性\n',
    });
  });
});
