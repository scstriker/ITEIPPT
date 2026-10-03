import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackgroundAssets } from '../template/assets';
import { renderPPTX, type SlideContent } from '../services/pptx/renderPptx';

interface GatePaths {
  projectRoot: string;
  docsDir: string;
  srcDir: string;
  outputDir: string;
  generatedPptx: string;
  reportJson: string;
  issueListMd: string;
  referencePptx: string;
}

function toImageDataUrl(base64Body: string): string {
  const cleaned = base64Body.replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
  return `image/jpeg;base64,${cleaned}`;
}

async function readBackgrounds(srcDir: string): Promise<BackgroundAssets> {
  const cover = await readFile(resolve(srcDir, 'template', 'bg-cover.base64'), 'utf8');
  const content = await readFile(resolve(srcDir, 'template', 'bg-content.base64'), 'utf8');
  return {
    coverBg: toImageDataUrl(cover),
    contentBg: toImageDataUrl(content),
  };
}

async function resolveReferencePptx(docsDir: string): Promise<string> {
  const files = await readdir(docsDir);
  const target = files.find((fileName) => /^1-.*\.pptx$/i.test(fileName));
  if (!target) {
    throw new Error('Cannot find reference pptx under docs/reference/ (expected 1-*.pptx).');
  }
  return resolve(docsDir, target);
}

function createSampleSlides(): SlideContent[] {
  return [
    {
      page: 1,
      type: 'cover',
      standardName: '医用呼吸机关键零部件 第1部分：压力传感器',
      planNumber: 'T/ITEI 2026-001',
      reportTitle: '团体标准送审稿审查汇报',
      presenter: '汇报人：Phase 1 Gate',
      date: '2026年04月09日',
    },
    {
      page: 2,
      type: 'toc_section',
      pageTitle: '汇报内容',
      highlightChapter: 1,
    },
    {
      page: 3,
      type: 'content',
      chapterTitle: '一、项目背景及必要性',
      subtitle: '项目背景及意义',
      bodyText:
        '本标准是工作组的第一项术语标准。旨在统一医疗装备产业与应用领域的术语和定义，为医疗装备的研发、生产、使用、服务及退役等环节提供通用语言基础和一致性指导，促进产业链上下游的协同发展。',
      highlightRanges: [
        [8, 11],
        [58, 78],
      ],
      visualMode: 'table',
      tableData: {
        headers: ['政策文件', '发布机构', '核心要求'],
        rows: [
          ['《“十四五”医疗装备产业发展规划》', '工信部、卫健委等', '完善医疗装备产业与应用标准体系建设'],
          ['《医疗器械监督管理条例》', '国务院', '支持基础研究和应用研究'],
          ['《优化全生命周期监管支持高端医疗器械创新发展有关举措》', '国家药监局', '强化标准引领创新，加快标准制修订'],
        ],
      },
    },
    {
      page: 4,
      type: 'ending',
      thanks: '敬请指正！',
      organization: '机械工业仪器仪表综合技术经济研究所',
      contactInfo: [
        '地址：北京市西城区广安门外大街甲397号',
        '电话：010-63261819',
        '传真：010-63262677',
        '网址：http://www.itei.cn',
      ],
    },
  ];
}

function runVisualCompare(paths: GatePaths): number {
  const compareScript = resolve(paths.srcDir, 'scripts', 'phase1_visual_compare.py');
  const args = [
    compareScript,
    '--generated',
    paths.generatedPptx,
    '--reference',
    paths.referencePptx,
    '--output-dir',
    paths.outputDir,
    '--issue-list',
    paths.issueListMd,
    '--report-json',
    paths.reportJson,
  ];

  const result = spawnSync('python', args, {
    cwd: paths.projectRoot,
    stdio: 'inherit',
  });
  if (typeof result.status === 'number') {
    return result.status;
  }
  return 1;
}

function runStructureGate(paths: GatePaths): number {
  const pythonScript = `
import re
import zipfile
import sys

generated_pptx = sys.argv[1]
reference_pptx = sys.argv[2]

def read_slide_xml(path, slide_no):
    with zipfile.ZipFile(path) as z:
        return z.read(f"ppt/slides/slide{slide_no}.xml").decode("utf-8")

def shape_count(xml):
    return len(re.findall(r"<p:sp>", xml))

def colors(xml):
    return set(re.findall(r'<a:srgbClr val="([0-9A-F]{6})"', xml))

errors = []

generated_slide2 = read_slide_xml(generated_pptx, 2)
reference_slide2 = read_slide_xml(reference_pptx, 2)
generated_slide3 = read_slide_xml(generated_pptx, 3)

if shape_count(generated_slide2) != shape_count(reference_slide2):
    errors.append(
        f"slide2 shape count mismatch: generated={shape_count(generated_slide2)}, reference={shape_count(reference_slide2)}"
    )

required_slide2_colors = {"044470", "FF0000", "FFFFFF"}
missing_slide2 = sorted(required_slide2_colors - colors(generated_slide2))
if missing_slide2:
    errors.append(f"slide2 missing key colors: {', '.join(missing_slide2)}")

required_slide3_colors = {"0000FF", "0070C0", "FF0000", "FFFFFF"}
missing_slide3 = sorted(required_slide3_colors - colors(generated_slide3))
if missing_slide3:
    errors.append(f"slide3 missing key colors: {', '.join(missing_slide3)}")

if errors:
    print("[Phase1 Gate] Structure assertions failed:")
    for item in errors:
        print(f"- {item}")
    sys.exit(1)

print("[Phase1 Gate] Structure assertions passed.")
`;

  const result = spawnSync('python', ['-c', pythonScript, paths.generatedPptx, paths.referencePptx], {
    cwd: paths.projectRoot,
    stdio: 'inherit',
  });

  if (typeof result.status === 'number') {
    return result.status;
  }
  return 1;
}

async function resolvePaths(): Promise<GatePaths> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(currentDir, '../..');
  const docsDir = resolve(projectRoot, 'docs');
  const srcDir = resolve(projectRoot, 'src');
  const outputDir = resolve(projectRoot, 'phase1_gate');
  mkdirSync(outputDir, { recursive: true });

  return {
    projectRoot,
    docsDir,
    srcDir,
    outputDir,
    generatedPptx: resolve(outputDir, 'phase1_gate_sample.pptx'),
    reportJson: resolve(outputDir, 'phase1_gate_report.json'),
    issueListMd: resolve(outputDir, 'phase1_issue_list.md'),
    referencePptx: await resolveReferencePptx(resolve(docsDir, 'reference')),
  };
}

async function main(): Promise<void> {
  const paths = await resolvePaths();
  const backgrounds = await readBackgrounds(paths.srcDir);
  const slides = createSampleSlides();

  const blob = await renderPPTX(slides, backgrounds);
  const buffer = Buffer.from(await blob.arrayBuffer());
  await writeFile(paths.generatedPptx, buffer);

  console.log(`[Phase1 Gate] Generated sample PPTX: ${paths.generatedPptx}`);
  console.log(`[Phase1 Gate] Reference PPTX: ${paths.referencePptx}`);

  const structureStatus = runStructureGate(paths);
  if (structureStatus !== 0) {
    process.exit(structureStatus);
  }

  const compareStatus = runVisualCompare(paths);
  if (compareStatus !== 0) {
    process.exit(compareStatus);
  }
}

main().catch((error) => {
  console.error('[Phase1 Gate] Failed:', error);
  process.exit(1);
});
