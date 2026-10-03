import type { ChapterPlan, FrameworkPlan } from '../contracts/framework';
import { callGeminiJson, getPlanModel } from '../gemini/client';
import type { GeminiOptions } from '../gemini/client';
import { MAX_TEXT_LENGTH, applyBlankPlanMinimum, buildBlankDraftPrompt, buildFallbackBlankChapters, parseDraftChapters, resolveBasePlan } from './basePlan';
import type { PlanRequestBody } from './basePlan';
import { applyChapterInsights, buildFallbackInsights, buildInsightsPrompt, parseChapterInsights, parseSlideInsights } from './insights';
import { isPresetId } from '../shared/planValues';
import { cleanText, truncateText } from '../shared/text';

export async function generatePlanWithGemini(
  options: GeminiOptions,
  reqBody: PlanRequestBody,
): Promise<FrameworkPlan> {
  if (!isPresetId(reqBody.presetId)) {
    throw new Error('invalid_preset');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }
  let basePlan = resolveBasePlan(reqBody);
  if (reqBody.presetId === 'blank') {
    basePlan = applyBlankPlanMinimum(basePlan);
  }
  const provider = `gemini:${getPlanModel(options)}`;
  const truncatedText = truncateText(textContent, MAX_TEXT_LENGTH);
  if (!basePlan.chapters.length) {
    if (reqBody.presetId === 'blank') {
      let draftChapters: ChapterPlan[] = [];
      try {
        const draftPrompt = buildBlankDraftPrompt(truncatedText);
        const draftJson = await callGeminiJson(options, getPlanModel(options), draftPrompt);
        draftChapters = parseDraftChapters(draftJson);
      } catch (error) {
        if (error instanceof Error && error.message === 'missing_api_key') {
          throw error;
        }
      }
      basePlan = applyBlankPlanMinimum({
        ...basePlan,
        chapters: draftChapters.length ? draftChapters : buildFallbackBlankChapters(),
      });
    } else {
      return applyChapterInsights(basePlan, [], [], provider);
    }
  }

  try {
    const prompt = buildInsightsPrompt(basePlan, truncatedText);
    const outputJson = await callGeminiJson(options, getPlanModel(options), prompt);
    const chapterInsights = parseChapterInsights(outputJson, basePlan.chapters.length);
    const slideInsights = parseSlideInsights(outputJson, basePlan);
    const planned = applyChapterInsights(basePlan, chapterInsights, slideInsights, provider);
    return reqBody.presetId === 'blank' ? applyBlankPlanMinimum(planned) : planned;
  } catch (error) {
    if (error instanceof Error && error.message === 'missing_api_key') {
      throw error;
    }
    const fallback = buildFallbackInsights(basePlan, truncatedText);
    const planned = applyChapterInsights(basePlan, fallback.chapterInsights, fallback.slideInsights, `${provider}:fallback`);
    return reqBody.presetId === 'blank' ? applyBlankPlanMinimum(planned) : planned;
  }
}
