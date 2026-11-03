import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const api = {};
new Function('exports', ts.transpileModule(fs.readFileSync('components/settings/organization-tree.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(api);
const entry = (id, name, parent, depth, isActive = true, type = 'shopping') => ({ depth, organization: { id, name, parentOrganizationId: parent, isActive, organizationTypeId: type, organizationType: { id: type, name: type, isActive: true } } });
const hierarchy = [entry('a', 'AD', null, 0, true, 'group'), entry('m', 'Shopping Mogi', 'a', 1), entry('b', 'Shopping ABC', 'a', 1, false), entry('u', 'AUDIT', null, 0, true, 'group'), entry('o', 'Unidade independente', null, 0, true, 'company')];
const none = { search: '', status: '', typeId: '' };
test('group folding hides its children, keeps accurate direct counts and preserves organizations without group', () => {
  const folded = api.organizationTreeRows(hierarchy, none, new Set(['a']));
  assert.deepEqual(folded.items.map(item => item.organization.id), ['a', 'u', 'o']);
  assert.equal(folded.items[0].childCount, 2); assert.equal(folded.items[0].isExpanded, false);
  const open = api.organizationTreeRows(hierarchy, none, new Set());
  assert.equal(open.items.length, 5);
});
test('search and status retain ancestor context while counting only matching organizations', () => {
  const filtered = api.organizationTreeRows(hierarchy, { search: '  shopping   abc ', status: 'false', typeId: '' }, new Set());
  assert.equal(filtered.matchCount, 1); assert.deepEqual(filtered.items.map(item => item.organization.id), ['a', 'b']);
  assert.equal(filtered.items[0].contextOnly, true); assert.equal(filtered.items[1].contextOnly, false);
});
test('orphan and broken cycle records remain visible without changing their stored links', () => {
  const broken = [entry('x', 'Cycle root', 'y', 0), entry('y', 'Cycle child', 'x', 1), entry('z', 'Orphan', 'missing', 0)];
  const before = JSON.stringify(broken);
  const result = api.organizationTreeRows(broken, none, new Set(['x', 'y']));
  assert.deepEqual(result.items.map(item => item.organization.id), ['x', 'z']); assert.equal(JSON.stringify(broken), before);
});
