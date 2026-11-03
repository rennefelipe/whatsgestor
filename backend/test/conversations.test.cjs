const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { QueryFailedError } = require('typeorm');
const { conversationsFixture, Conversation, Message, Media, Contact, User } = require('./helpers/conversations-fixture.cjs');
const status = (code) => (error) => error.getStatus?.() === code;
const page = { page: 1, pageSize: 50 };
const ended = new Date('2026-10-01T12:00:00Z'), newer = new Date('2026-10-01T12:00:01Z');
const state = (f) => f.state.get(Conversation).find((row) => row.id === f.conversation.id);
const incoming = (f, values = {}) => ({ connectionId: f.connectionId, remoteJid: f.conversation.remoteJid,
  whatsappMessageId: 'fixture-message', fromMe: false, origin: 'live', messageTimestamp: newer, ...values });
const finished = (f) => Object.assign(state(f), { attendanceStatus: 'finished', assignedUserId: f.regular.id,
  attendanceStartedAt: new Date('2026-10-01T11:00:00Z'), attendanceFinishedAt: ended, lastMessageAt: ended });

test('conversation list orders latest activity first and safely combines filters and search', async (t) => {
  const f = await conversationsFixture(t);
  Object.assign(state(f), { lastMessageAt: ended, contactId: f.contact.id, assignedUserId: f.regular.id });
  const recent = f.seedConversation({ lastMessageAt: newer });
  const result = await f.conversations.findAll({ ...page, pageSize: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.items[0].id, recent.id);
  assert.equal(result.pageSize, 1);
  const filters = { ...page, connectionId: f.connectionId, attendanceStatus: 'waiting', assignedUserId: f.regular.id,
    contactId: f.contact.id, search: f.contact.contactName };
  const filtered = await f.conversations.findAll(filters);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].contact.id, f.contact.id);
  assert.deepEqual(Object.keys(filtered.items[0].assignedUser).sort(), ['id', 'username']);
  const query = f.queries.findLast(item=>item.parameters.assignedUserId!==undefined);
  assert.match(query.sql, /lastMessageAt.*DESC/);
  assert.match(query.sql, /assignedUserId.*@/);
  assert.equal(query.parameters.assignedUserId, f.regular.id);
  const unsafe = "a%_[~' OR 1=1";
  await f.conversations.findAll({ ...page, search: unsafe });
  assert.equal(f.queries.at(-1).sql.includes(unsafe), false);
  assert.equal(f.queries.at(-1).parameters.search, "%a~%~_~[~~' OR 1=1%");
  assert.match(f.queries.at(-1).sql, /ESCAPE '~'/);
  assert.equal(f.writes.length, 0);
});

test('history uses message time before insertion time, stable pagination and private media projection', async (t) => {
  const f = await conversationsFixture(t);
  const seed = (id, timestamp, createdAt) => f.seed(Message, { conversationId: f.conversation.id,
    whatsappMessageId: id, fromMe: false, messageType: 'text', textContent: null, status: 'received', messageTimestamp: timestamp, createdAt });
  const late = seed('late', newer, ended), early = seed('early', ended, newer);
  const undated = seed('unknown-time', null, new Date('2020-01-01T00:00:00Z'));
  f.seed(Media, { messageId: early.id, kind: 'image', availability: 'ready', mimeType: 'image/png',
    originalName: 'fixture.png', sizeBytes: 10, durationSeconds: null, storageKey: 'private-storage-marker' });
  const result = await f.conversations.findMessages(f.conversation.id, { page: 1, pageSize: 2 });
  assert.deepEqual(result.items.map((row) => row.id), [early.id, late.id]);
  assert.equal(result.total, 3);
  assert.equal(result.items[0].media.kind, 'image');
  assert.equal(JSON.stringify(result).includes('private-storage-marker'), false);
  assert.equal(f.queries.at(-1).sql.includes('storageKey'), false);
  assert.match(f.queries.at(-1).sql, /message_timestamp_missing.*ASC/);
  assert.equal((await f.conversations.findMessages(f.conversation.id, { page: 2, pageSize: 2 })).items[0].id, undated.id);
  await assert.rejects(f.conversations.findMessages(randomUUID(), page), status(404));
  assert.equal(f.writes.length, 0);
});

test('manual attendance preserves transitions, UTC timestamps and previous ownership information', async (t) => {
  const f = await conversationsFixture(t);
  const claimed = await f.attendance.claim(f.conversation.id, f.regular.id);
  assert.equal(claimed.attendanceStatus, 'in_progress');
  assert.equal(claimed.assignedUserId, f.regular.id);
  assert.ok(claimed.attendanceStartedAt instanceof Date);
  const closed = await f.attendance.finish(f.conversation.id, f.regular.id);
  assert.equal(closed.attendanceStatus, 'finished');
  assert.equal(closed.assignedUserId, f.regular.id);
  const reopened = await f.attendance.reopen(f.conversation.id, f.other.id);
  assert.equal(reopened.attendanceStatus, 'waiting');
  assert.equal(reopened.assignedUserId, null);
  assert.equal(reopened.attendanceStartedAt.getTime(), closed.attendanceStartedAt.getTime());
  assert.equal(reopened.attendanceFinishedAt.getTime(), closed.attendanceFinishedAt.getTime());
  const next = await f.attendance.claim(f.conversation.id, f.other.id);
  assert.equal(next.assignedUserId, f.other.id);
  assert.equal(next.attendanceFinishedAt, null);
  assert.ok(f.locks.some((lock) => lock.entity === 'User' && lock.mode === 'pessimistic_read'));
  assert.ok(f.locks.some((lock) => lock.entity === 'WhatsappConversation' && lock.mode === 'pessimistic_write'));
});

test('only the owner or admin can finish; only admin can transfer to an active user', async (t) => {
  const f = await conversationsFixture(t);
  await f.attendance.claim(f.conversation.id, f.regular.id);
  const started = state(f).attendanceStartedAt.getTime();
  await assert.rejects(f.attendance.finish(f.conversation.id, f.other.id), status(403));
  await assert.rejects(f.attendance.assign(f.conversation.id, f.other.id, f.other.id), status(403));
  await assert.rejects(f.attendance.assign(f.conversation.id, f.admin.id, randomUUID()), status(400));
  const inactive = f.seed(User, { username: 'inactive-fixture', isAdmin: false, isActive: false });
  await assert.rejects(f.attendance.assign(f.conversation.id, f.admin.id, inactive.id), status(400));
  const result = await f.attendance.assign(f.conversation.id, f.admin.id, f.other.id);
  assert.equal(result.assignedUserId, f.other.id);
  assert.equal(result.attendanceStartedAt.getTime(), started);
  await assert.rejects(f.attendance.finish(f.conversation.id, f.regular.id), status(403));
  assert.equal((await f.attendance.finish(f.conversation.id, f.admin.id)).attendanceStatus, 'finished');
});

test('attendance rejects invalid states, missing conversations and inactive actors without writes', async (t) => {
  const f = await conversationsFixture(t);
  for (const action of ['finish', 'reopen']) await assert.rejects(f.attendance[action](f.conversation.id, f.regular.id), status(409));
  await assert.rejects(f.attendance.assign(f.conversation.id, f.admin.id, f.other.id), status(409));
  await assert.rejects(f.attendance.claim(randomUUID(), f.regular.id), status(404));
  f.state.get(User).find((user) => user.id === f.regular.id).isActive = false;
  await assert.rejects(f.attendance.claim(f.conversation.id, f.regular.id), status(401));
  await assert.rejects(f.attendance.claim(f.conversation.id, randomUUID()), status(401));
  assert.equal(f.writes.length, 0);
});

test('concurrent claims have one winner and one conflict using conversation row locks', async (t) => {
  const f = await conversationsFixture(t);
  const results = await Promise.allSettled([f.attendance.claim(f.conversation.id, f.regular.id), f.attendance.claim(f.conversation.id, f.other.id)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.getStatus(), 409);
  assert.equal(f.writes.length, 1);
  assert.equal(f.locks.filter((lock) => lock.entity === 'WhatsappConversation').length, 2);
});

test('contact linking and unlinking preserve remote identity and attendance without editing contacts', async (t) => {
  const f = await conversationsFixture(t);
  const original = structuredClone(f.state.get(Contact));
  await f.attendance.claim(f.conversation.id, f.regular.id);
  let result = await f.conversations.updateContact(f.conversation.id, f.contact.id);
  assert.equal(result.contact.contactName, f.contact.contactName);
  assert.deepEqual(Object.keys(result.contact).sort(), ['contactName', 'id']);
  result = await f.conversations.updateContact(f.conversation.id, null);
  assert.equal(result.contact, null);
  assert.equal(result.remoteJid, f.conversation.remoteJid);
  assert.equal(result.assignedUserId, f.regular.id);
  assert.deepEqual(f.state.get(Contact), original);
  f.state.get(Contact).find((contact) => contact.id === f.contact.id).isActive = false;
  await assert.rejects(f.conversations.updateContact(f.conversation.id, f.contact.id), status(400));
  await assert.rejects(f.conversations.updateContact(randomUUID(), null), status(404));
});

test('new live incoming messages reopen only after the finishing timestamp and preserve prior timestamps', async (t) => {
  const f = await conversationsFixture(t); finished(f);
  const before = structuredClone(state(f));
  const message = await f.records.record(incoming(f));
  assert.equal(message.conversationId, f.conversation.id);
  assert.equal(state(f).attendanceStatus, 'waiting');
  assert.equal(state(f).assignedUserId, null);
  assert.equal(state(f).attendanceFinishedAt.getTime(), before.attendanceFinishedAt.getTime());
  assert.equal(state(f).lastMessageAt.getTime(), newer.getTime());
  assert.equal(f.transactions[0], 'SERIALIZABLE');
  assert.equal(f.state.get(Message).length, 1);
});

test('history, outgoing, groups, missing timestamps and older messages cannot auto-reopen', async (t) => {
  for (const values of [{ origin: 'history' }, { origin: 'outgoing', fromMe: true }, { fromMe: true },
    { messageTimestamp: null }, { messageTimestamp: ended }, { messageTimestamp: new Date('2020-01-01T00:00:00Z') }, { remoteJid: 'fixture-group@g.us' }]) {
    const f = await conversationsFixture(t); finished(f);
    if (values.remoteJid) state(f).remoteJid = values.remoteJid;
    await f.records.record(incoming(f, values));
    assert.equal(state(f).attendanceStatus, 'finished');
    assert.equal(state(f).assignedUserId, f.regular.id);
    assert.ok(state(f).lastMessageAt.getTime() >= ended.getTime());
  }
});

test('concurrent duplicate messages are persisted once and redelivery cannot reopen a reclosed conversation', async (t) => {
  const f = await conversationsFixture(t); finished(f);
  const results = await Promise.all([f.records.record(incoming(f)), f.records.record(incoming(f))]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(f.state.get(Message).length, 1);
  await f.attendance.claim(f.conversation.id, f.regular.id);
  await f.attendance.finish(f.conversation.id, f.regular.id);
  const writes = f.writes.length;
  await f.records.record(incoming(f));
  assert.equal(f.writes.length, writes);
  assert.equal(state(f).attendanceStatus, 'finished');
});

test('conversation creation is unique and message direction is part of the deduplication key', async (t) => {
  const f = await conversationsFixture(t);
  const remoteJid = 'new-fixture@lid';
  const results = await Promise.all([f.records.record(incoming(f, { remoteJid, whatsappMessageId: 'A' })), f.records.record(incoming(f, { remoteJid, whatsappMessageId: 'B' }))]);
  assert.equal(results[0].conversationId, results[1].conversationId);
  assert.equal(f.state.get(Conversation).filter((row) => row.remoteJid === remoteJid).length, 1);
  await f.records.record(incoming(f, { remoteJid, whatsappMessageId: 'A', fromMe: true, origin: 'outgoing' }));
  assert.equal(f.state.get(Message).length, 3);
});

test('metadata and message persistence roll back atomically and retries are bounded', async (t) => {
  const f = await conversationsFixture(t); finished(f);
  f.faults.set(Conversation, new Error('isolated metadata failure'));
  await assert.rejects(f.records.record(incoming(f)), /isolated metadata failure/);
  assert.equal(f.state.get(Message).length, 0);
  assert.equal(state(f).attendanceStatus, 'finished');
  assert.equal(state(f).lastMessageAt.getTime(), ended.getTime());
  f.faults.delete(Conversation);
  let attempts = 0;
  t.mock.method(f.repos.get(Message), 'save', async () => {
    attempts++; throw new QueryFailedError('fixture', [], Object.assign(new Error('deadlock fixture'), { number: 1205 }));
  });
  await assert.rejects(f.records.record(incoming(f)), (error) => error.driverError.number === 1205);
  assert.equal(attempts, 3);
  assert.equal(f.state.get(Message).length, 0);
});

test('unique-key recovery occurs after rollback and duplicates never trigger reopening', async (t) => {
  const f = await conversationsFixture(t); finished(f);
  const repository = f.repos.get(Message), save = repository.save;
  let first = true;
  t.mock.method(repository, 'save', async (values) => {
    if (!first) return save(values);
    first = false;
    f.seed(Message, { ...values, id: randomUUID() }); // Simulates a different committed writer.
    throw new QueryFailedError('fixture', [], Object.assign(new Error('duplicate fixture'), { number: 2627 }));
  });
  await f.records.record(incoming(f));
  assert.equal(f.state.get(Message).length, 1);
  assert.equal(state(f).attendanceStatus, 'finished');
});

test('new timestamps never regress conversation activity, regardless of direction or arrival order', async (t) => {
  const f = await conversationsFixture(t);
  await f.records.record(incoming(f, { fromMe: true, origin: 'outgoing', whatsappMessageId: 'out' }));
  await f.records.record(incoming(f, { origin: 'history', messageTimestamp: ended, whatsappMessageId: 'older' }));
  assert.equal(state(f).lastMessageAt.getTime(), newer.getTime());
  await f.records.record(incoming(f, { messageTimestamp: null, whatsappMessageId: 'undated' }));
  assert.equal(state(f).lastMessageAt.getTime(), newer.getTime());
});

test('invalid internal records and missing connections are rejected without writes', async (t) => {
  const f = await conversationsFixture(t);
  for (const input of [{ connectionId: 'invalid' }, { whatsappMessageId: '' }, { origin: undefined },
    { messageTimestamp: new Date('invalid') }, { origin: 'outgoing', fromMe: false }]) {
    await assert.rejects(f.records.record(incoming(f, input)), status(400));
  }
  await assert.rejects(f.records.record(incoming(f, { connectionId: randomUUID() })), status(404));
  assert.equal(f.writes.length, 0);
});

test('HTTP conversations preserve contracts, authentication, permissions and pagination', async (t) => {
  const f = await conversationsFixture(t, true), path = '/whatsapp-conversations/' + f.conversation.id;
  const bearer = await f.token(f.regular), admin = await f.token(f.admin);
  assert.equal((await f.call('/whatsapp-conversations')).status, 401);
  const list = await f.call('/whatsapp-conversations', { bearer });
  assert.equal(list.status, 200);
  assert.deepEqual(Object.keys(list.body).sort(), ['items', 'page', 'pageSize', 'total']);
  assert.equal(list.body.pageSize, 50);
  assert.equal((await f.call(path + '/attendance/claim', { bearer, method: 'POST' })).body.assignedUserId, f.regular.id);
  assert.equal((await f.call(path + '/attendance/claim', { bearer, method: 'POST' })).status, 409);
  assert.equal((await f.call(path + '/attendance/assign', { bearer, method: 'PATCH', body: { assignedUserId: f.other.id } })).status, 200);
  assert.equal((await f.call(path + '/attendance/assign', { bearer, method: 'PATCH', body: { assignedUserId: f.regular.id } })).status, 403);
  assert.equal((await f.call(path + '/attendance/assign', { bearer: admin, method: 'PATCH', body: { assignedUserId: f.regular.id } })).status, 200);
  assert.equal((await f.call(path + '/attendance/finish', { bearer: admin, method: 'POST' })).status, 200);
  assert.equal((await f.call(path + '/attendance/reopen', { bearer, method: 'POST' })).status, 200);
  const linked = await f.call(path + '/contact', { bearer, method: 'PATCH', body: { contactId: f.contact.id } });
  assert.equal(linked.status, 200);
  assert.deepEqual(Object.keys(linked.body.contact).sort(), ['contactName', 'id']);
  assert.equal((await f.call(path + '/contact', { bearer, method: 'PATCH', body: { contactId: null } })).body.contact, null);
  assert.equal((await f.call(path + '/messages', { bearer })).status, 200);
  assert.equal((await f.call(path, { bearer })).status, 200);
});

test('HTTP rejects invalid UUIDs and payloads and keeps send/upload transport disabled', async (t) => {
  const f = await conversationsFixture(t, true), bearer = await f.token(f.regular);
  const path = '/whatsapp-conversations/' + f.conversation.id;
  for (const query of ['page=0', 'pageSize=101', 'attendanceStatus=invalid', 'assignedUserId=invalid', 'connectionId=invalid', 'contactId=invalid', 'extra=value']) {
    assert.equal((await f.call('/whatsapp-conversations?' + query, { bearer })).status, 400);
  }
  for (const body of [{}, { contactId: 'invalid' }, { contactId: null, extra: true }]) {
    assert.equal((await f.call(path + '/contact', { bearer, method: 'PATCH', body })).status, 400);
  }
  assert.equal((await f.call('/whatsapp-conversations/invalid', { bearer })).status, 400);
  assert.equal((await f.call('/whatsapp-conversations/' + randomUUID(), { bearer })).status, 404);
  assert.equal((await f.call(path + '/messages?pageSize=101', { bearer })).status, 400);
  for (const suffix of ['/messages', '/messages/attachments', '/messages/audio']) {
    assert.equal((await f.call(path + suffix, { bearer, method: 'POST', body: {} })).status, 503);
  }
  assert.equal(f.writes.length, 0);
});
