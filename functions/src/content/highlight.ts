

export interface TextRangeCandidate {
  text: string;
  start: number;
  end: number;
  score: number;
  mappingHits: number;
  priorityHits: number;
  source: 'phrase' | 'sentence';
}

export const HIGHLIGHT_DOMAIN_KEYWORDS = [
  '战略',
  '目标',
  '定位',
  '问题',
  '资源',
  '平台',
  '能力',
  '路径',
  '方案',
  '实施',
  '服务',
  '网站',
  '云服务',
  '数据',
  '指标',
  '成本',
  '收益',
  '风险',
  '结论',
  '建议',
  '算力',
  '存储',
];

export const STRONG_DELIMITERS = new Set(['。', '！', '？', '；', ';', '\n']);

export const WEAK_DELIMITERS = new Set(['，', ',', '、', '：', ':']);

export const SIGNAL_KEYWORD_PATTERN = /\d|%|KPI|AI|GPU|CPU|指标|比例|增长|上升|下降|提升/i;

export function isTrimBoundaryChar(char: string): boolean {
  return /\s/.test(char) || '，。！？；;、：:（）()【】《》「」“”\'`'.includes(char);
}

export function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let left = start;
  let right = end;
  while (left < right && isTrimBoundaryChar(text[left])) {
    left += 1;
  }
  while (right > left && isTrimBoundaryChar(text[right - 1])) {
    right -= 1;
  }
  if (right <= left) {
    return null;
  }
  return { start: left, end: right };
}

export function splitRangesByDelimiters(
  text: string,
  start: number,
  end: number,
  delimiters: Set<string>,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (let index = start; index < end; index += 1) {
    const char = text[index];
    if (!delimiters.has(char)) {
      continue;
    }
    if (cursor < index) {
      ranges.push({ start: cursor, end: index });
    }
    cursor = index + 1;
  }
  if (cursor < end) {
    ranges.push({ start: cursor, end });
  }
  return ranges;
}

export function extractKeywords(text: string, maxCount = 8): string[] {
  const stopwords = new Set([
    '鏈珷',
    '鏈〉',
    '鏈',
    '閫氳繃',
    '杩涜',
    '鎻愬嚭',
    '璇存槑',
    '瀹炵幇',
    '鐩稿叧',
    '浠ュ強',
    '鍏朵腑',
  ]);
  const matches = text.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,8}/g) ?? [];
  const unique: string[] = [];
  for (const token of matches) {
    if (stopwords.has(token)) {
      continue;
    }
    if (!unique.includes(token)) {
      unique.push(token);
    }
    if (unique.length >= maxCount) {
      break;
    }
  }
  return unique;
}

export function countKeywordHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (keyword && text.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

export function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function dedupeKeywords(words: string[]): string[] {
  const output: string[] = [];
  for (const word of words) {
    if (!word || output.includes(word)) {
      continue;
    }
    output.push(word);
  }
  return output;
}

export function buildHighlightKeywordContext(subtitle?: string, chapterTitle?: string): {
  priorityKeywords: string[];
  mappingKeywords: string[];
} {
  const titleWords = extractKeywords([subtitle ?? '', chapterTitle ?? ''].filter(Boolean).join(' '), 12);
  const priorityKeywords = dedupeKeywords(titleWords);
  const mappingKeywords = dedupeKeywords([...priorityKeywords, ...HIGHLIGHT_DOMAIN_KEYWORDS]);
  return {
    priorityKeywords,
    mappingKeywords,
  };
}

export function sortHighlightCandidates(candidates: TextRangeCandidate[]): TextRangeCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.priorityHits !== a.priorityHits) {
      return b.priorityHits - a.priorityHits;
    }
    if (b.mappingHits !== a.mappingHits) {
      return b.mappingHits - a.mappingHits;
    }
    const lenA = Math.abs(16 - Array.from(a.text).length);
    const lenB = Math.abs(16 - Array.from(b.text).length);
    if (lenA !== lenB) {
      return lenA - lenB;
    }
    return a.start - b.start;
  });
}

export function selectCandidates(
  candidates: TextRangeCandidate[],
  maxCount: number,
  maxCoverage: number,
): TextRangeCandidate[] {
  const sorted = sortHighlightCandidates(candidates);
  const selected: TextRangeCandidate[] = [];
  let coveredChars = 0;
  for (const candidate of sorted) {
    if (selected.length >= maxCount) {
      break;
    }
    if (selected.some((picked) => rangesOverlap(picked, candidate))) {
      continue;
    }
    const nextLength = candidate.end - candidate.start;
    if (coveredChars + nextLength > maxCoverage) {
      continue;
    }
    selected.push(candidate);
    coveredChars += nextLength;
  }
  return selected;
}

export function createHighlightCandidate(
  text: string,
  range: { start: number; end: number },
  context: { priorityKeywords: string[]; mappingKeywords: string[] },
  source: 'phrase' | 'sentence',
): TextRangeCandidate | null {
  const trimmed = trimRange(text, range.start, range.end);
  if (!trimmed) {
    return null;
  }
  const candidateText = text.slice(trimmed.start, trimmed.end);
  const length = Array.from(candidateText).length;
  if (length < 8) {
    return null;
  }
  if (source === 'phrase' && length > 28) {
    return null;
  }
  if (source === 'sentence' && length > 88) {
    return null;
  }

  const priorityHits = countKeywordHits(candidateText, context.priorityKeywords);
  const domainHits = countKeywordHits(candidateText, HIGHLIGHT_DOMAIN_KEYWORDS);
  const mappingHits = countKeywordHits(candidateText, context.mappingKeywords);
  const signalScore = SIGNAL_KEYWORD_PATTERN.test(candidateText) ? 2 : 0;
  const lengthTarget = source === 'phrase' ? 16 : 24;
  const lengthScore = Math.max(0, 3 - Math.floor(Math.abs(lengthTarget - length) / 5));
  const sourceBonus = source === 'phrase' ? 2 : 1;
  const score = sourceBonus + priorityHits * 6 + mappingHits * 4 + domainHits * 2 + signalScore + lengthScore;

  return {
    text: candidateText,
    start: trimmed.start,
    end: trimmed.end,
    score,
    mappingHits,
    priorityHits,
    source,
  };
}

export function deriveSemanticHighlightRanges(bodyText: string, subtitle?: string, chapterTitle?: string): Array<[number, number]> {
  if (!bodyText.trim()) {
    return [];
  }
  const text = bodyText;
  const maxCoverage = Math.max(12, Math.floor(text.length * 0.35));
  const context = buildHighlightKeywordContext(subtitle, chapterTitle);
  const sentenceRanges = splitRangesByDelimiters(text, 0, text.length, STRONG_DELIMITERS);

  const phraseMap = new Map<string, TextRangeCandidate>();
  for (const sentence of sentenceRanges) {
    const phraseRanges = splitRangesByDelimiters(text, sentence.start, sentence.end, WEAK_DELIMITERS);
    for (const phraseRange of phraseRanges) {
      const candidate = createHighlightCandidate(text, phraseRange, context, 'phrase');
      if (!candidate || candidate.mappingHits < 1) {
        continue;
      }
      const key = `${candidate.start}:${candidate.end}`;
      const prev = phraseMap.get(key);
      if (!prev || candidate.score > prev.score) {
        phraseMap.set(key, candidate);
      }
    }
  }

  const selectedPhrases = selectCandidates([...phraseMap.values()], 2, maxCoverage);
  if (selectedPhrases.length > 0) {
    return selectedPhrases
      .sort((a, b) => a.start - b.start)
      .map((item) => [item.start, item.end] as [number, number]);
  }

  const sentenceCandidates: TextRangeCandidate[] = [];
  for (const sentenceRange of sentenceRanges) {
    const candidate = createHighlightCandidate(text, sentenceRange, context, 'sentence');
    if (!candidate) {
      continue;
    }
    if (candidate.priorityHits < 1 && candidate.mappingHits < 1) {
      continue;
    }
    sentenceCandidates.push(candidate);
  }

  const selectedSentence = selectCandidates(sentenceCandidates, 1, maxCoverage);
  if (!selectedSentence.length) {
    return [];
  }

  const bestSentence = selectedSentence[0];
  return [[bestSentence.start, bestSentence.end]];
}
