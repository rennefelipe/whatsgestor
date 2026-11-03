import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function callback(file, find, context = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) { if (find(node)) result = node; ts.forEachChild(node, visit); }
  visit(source);
  assert.ok(result, 'real source callback must exist');
  return vm.runInNewContext(ts.transpileModule('(' + result.getText(source) + ')', { compilerOptions: { target: 7 } }).outputText, context);
}

test('polling preserves selected conversation outside filters/pages and refreshes its metadata', () => {
  const original = { id: 'a', attendanceStatus: 'waiting', contactName: 'Anterior' };
  const ref = { current: original }; let selected; let clears = 0;
  const reconcile = callback('components/whatsapp/whatsapp-conversations-screen.tsx', node => ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && node.parent.expression.getText() === 'useCallback' && node.getText().includes('const currentId'), {
    categoryRef: { current: 'waiting' }, searchRef: { current: '' }, selectedConversationRef: ref,
    filterConversations: items => items.filter(row => row.attendanceStatus === 'waiting'),
    setMessages: () => clears++, setMessageTotal: () => {}, setMessagePage: () => {},
    setShowConversationOnMobile: () => assert.fail('selection must stay open'), setSelectedConversation: value => { selected = value; },
  });
  const fresh = { ...original, attendanceStatus: 'finished', contactName: 'Atualizado', assignedUserId: 'operator' };
  reconcile([fresh]); assert.equal(selected, fresh); assert.equal(clears, 0);
  reconcile([]); assert.equal(selected, fresh); assert.equal(clears, 0);
  const visible = { ...fresh, attendanceStatus: 'waiting' }; reconcile([visible]); assert.equal(selected, visible);
});

test('real audio callbacks discover indefinite duration then restore playback position', () => {
  const handler = name => callback('components/whatsapp/conversation-media.tsx', node => ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText() === name);
  const loaded = handler('onLoadedMetadata'), changed = handler('onDurationChange');
  for (const duration of [Infinity, 0, NaN]) {
    const audio = { duration, currentTime: 0 }; loaded({ currentTarget: audio }); assert.equal(audio.currentTime, 1e10);
    audio.duration = 4.25; changed({ currentTarget: audio }); assert.equal(audio.currentTime, 0);
  }
  const audio = { duration: 4.25, currentTime: 2 }; loaded({ currentTarget: audio }); changed({ currentTarget: audio }); assert.equal(audio.currentTime, 2);
});
