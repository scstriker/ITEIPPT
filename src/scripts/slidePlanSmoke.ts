import assert from 'node:assert/strict';
import {
  addSlide,
  changeSlideType,
  loadDefaultSlidePlan,
  removeSlide,
} from '../config/slidePlan';

function assertSequentialPageNumbers(plan: ReturnType<typeof loadDefaultSlidePlan>): void {
  plan.forEach((item, idx) => {
    assert.equal(item.slideNumber, idx + 1, `slideNumber mismatch at index ${idx}`);
  });
}

function main(): void {
  const defaultPlan = loadDefaultSlidePlan();
  assert.equal(defaultPlan.length, 21, 'default plan should contain 21 slides from template');
  assertSequentialPageNumbers(defaultPlan);

  const withNewContent = addSlide(defaultPlan, 1, 'content');
  assert.equal(withNewContent.length, 22, 'addSlide should append one item');
  assert.equal(withNewContent[2].slideType, 'content', 'inserted slide type mismatch');
  assert.equal(withNewContent[2].visualMode, 'none', 'content slide should default visualMode=none');
  assertSequentialPageNumbers(withNewContent);

  const changed = changeSlideType(withNewContent, 0, 'ending');
  assert.equal(changed[0].slideType, 'ending', 'changeSlideType should mutate target slide type');
  assert.equal(changed[0].visualMode, undefined, 'non-content slide should clear visualMode');
  assertSequentialPageNumbers(changed);

  const removed = removeSlide(changed, 3);
  assert.equal(removed.length, 21, 'removeSlide should remove one item');
  assertSequentialPageNumbers(removed);

  // eslint-disable-next-line no-console
  console.log('[SlidePlan] Smoke tests passed.');
}

main();
