const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSeedanceReferenceRoleInstruction,
  buildVideoImageBudgetInstruction,
} = require('../templates/shared-frame');

function buildReferences(count) {
  return Array.from({ length: count }, (_, index) => ({
    refId: `图片${index + 1}`,
    name: `参考素材${index + 1}`,
    type: index === 0 ? 'scene' : 'character',
  }));
}

test('Seedance 2.5 prompt templates allow image references above the legacy ninth slot', () => {
  const references = buildReferences(12);
  const roleInstruction = buildSeedanceReferenceRoleInstruction(references, '测试时', 30);
  const budgetInstruction = buildVideoImageBudgetInstruction(references, 30);

  assert.match(roleInstruction, /Seedance 2\.5/);
  assert.match(roleInstruction, /最多支持 30 张参考图/);
  assert.match(budgetInstruction, /图片1到图片12/);
  assert.match(budgetInstruction, /禁止图片13或更大编号/);
  assert.doesNotMatch(budgetInstruction, /禁止图片10/);
});

test('legacy Seedance prompt templates keep the nine-image safety limit', () => {
  const references = buildReferences(9);
  const roleInstruction = buildSeedanceReferenceRoleInstruction(references, '测试时', 9);
  const budgetInstruction = buildVideoImageBudgetInstruction(references, 9);

  assert.match(roleInstruction, /Seedance 2\.0/);
  assert.match(roleInstruction, /最多支持 9 张参考图/);
  assert.match(budgetInstruction, /图片1到图片9/);
  assert.match(budgetInstruction, /禁止图片10或更大编号/);
});
