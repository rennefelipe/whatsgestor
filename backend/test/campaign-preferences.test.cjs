const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { registrationsFixture, Contact, ContactType, Organization, Preference, PreferenceEvent } = require('./helpers/registrations-fixture.cjs');
const { ContactsService } = require('../dist/contacts/contacts.service');
const { ContactCampaignPreferencesService } = require('../dist/contacts/contact-campaign-preferences.service');
const status = (expected) => (error) => error.getStatus?.() === expected;
const page = { page: 1, pageSize: 10 };
const request = { target: 'phone', shoppingId: null, reason: 'Solicitação fictícia' };
function service(f) { return new ContactCampaignPreferencesService(f.source, new ContactsService(f.repos.get(Contact), f.repos.get(ContactType), f.repos.get(Organization))); }

test('campaign phone restrictions are canonical, scoped and audited without rewriting contacts', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  const before = structuredClone(f.state.get(Contact));
  const row = await s.create(f.contact.id, request, f.admin);
  assert.equal(row.normalizedPhone, '+5511987654321');
  assert.equal(row.whatsappIdentity, null);
  assert.equal(row.version, 1);
  assert.equal(row.createdBy, f.admin.id);
  assert.equal(f.state.get(PreferenceEvent).length, 1);
  const event = f.state.get(PreferenceEvent)[0];
  assert.equal(event.actorUsername, f.admin.username);
  assert.equal(event.action, 'block');
  assert.equal(event.beforeState, null);
  assert.equal(JSON.parse(event.afterState).id, row.id);
  assert.deepEqual(f.state.get(Contact), before);
  await assert.rejects(s.create(f.contact.id, request, f.admin), status(409));
  const scoped = await s.create(f.contact.id, { ...request, shoppingId: f.shopping.id }, f.admin);
  assert.notEqual(scoped.id, row.id);
  const result = await s.list(f.contact.id, page);
  assert.equal(result.total, 2);
  assert.equal(result.affectedContacts, 1);
  assert.equal(result.normalizedPhone, '+5511987654321');
  assert.equal((await s.snapshot()).rules.length, 2);
});

test('revocation confirms intent and version and keeps immutable before/after history', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  const row = await s.create(f.contact.id, request, f.admin);
  await assert.rejects(s.revoke(row.id, { version: 1, reason: 'Revogação fictícia', confirmed: false }, f.admin), status(400));
  await assert.rejects(s.revoke(row.id, { version: 2, reason: 'Revogação fictícia', confirmed: true }, f.admin), status(409));
  const revoked = await s.revoke(row.id, { version: 1, reason: 'Revogação fictícia', confirmed: true }, f.admin);
  assert.equal(revoked.version, 2);
  assert.equal(revoked.isActive, false);
  assert.ok(revoked.revokedAt instanceof Date);
  const history = await s.events(row.id, page);
  assert.equal(history.total, 2);
  const event = history.items.find((item) => item.action === 'revoke');
  assert.equal(JSON.parse(event.beforeState).isActive, true);
  assert.equal(JSON.parse(event.afterState).isActive, false);
  await assert.rejects(s.revoke(row.id, { version: 2, reason: 'Repeated revocation', confirmed: true }, f.admin), status(409));
  assert.equal((await s.create(f.contact.id, request, f.admin)).isActive, true);
});

test('audit failure rolls back both creation and revocation and CAS conflicts remain conflicts', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  f.failures.set(PreferenceEvent, new Error('isolated audit failure'));
  await assert.rejects(s.create(f.contact.id, request, f.admin), status(503));
  assert.equal(f.state.get(Preference).length, 0);
  f.failures.delete(PreferenceEvent);
  const row = await s.create(f.contact.id, request, f.admin);
  f.failures.set(PreferenceEvent, new Error('isolated audit failure'));
  await assert.rejects(s.revoke(row.id, { version: 1, reason: 'Failed audit fixture', confirmed: true }, f.admin), status(503));
  assert.equal(f.state.get(Preference)[0].isActive, true);
  assert.equal(f.state.get(Preference)[0].version, 1);
  assert.equal(f.state.get(PreferenceEvent).length, 1);
  f.failures.delete(PreferenceEvent);
  t.mock.method(f.repos.get(Preference), 'update', async () => ({ affected: 0 }));
  await assert.rejects(s.revoke(row.id, { version: 1, reason: 'Concurrent revocation', confirmed: true }, f.admin), status(409));
  assert.equal(f.state.get(PreferenceEvent).length, 1);
});

test('identity restrictions use only observed links in their connection and never infer phone aliases', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  const conversationId = randomUUID(), connectionId = randomUUID();
  await assert.rejects(s.create(f.contact.id, { ...request, target: 'identity', evidenceConversationId: conversationId }, f.admin), status(400));
  f.identities.push({ contactId: f.contact.id, conversationId, connectionId, whatsappIdentity: '123456789@lid' });
  const row = await s.create(f.contact.id, { ...request, target: 'identity', evidenceConversationId: conversationId }, f.admin);
  assert.equal(row.whatsappIdentity, '123456789@lid');
  assert.equal(row.normalizedPhone, null);
  assert.equal(row.connectionId, connectionId);
  assert.equal(row.evidenceConversationId, conversationId);
  assert.equal((await s.list(f.contact.id, page)).identities.length, 1);
  const query = f.queries.find((item) => item.sql.includes('whatsapp_conversations'));
  assert.match(query.sql, /FETCH NEXT 1001 ROWS ONLY/);
  assert.equal(query.parameters.contactId, f.contact.id);
  assert.equal(f.source.entityMetadatas.some((item) => item.tableName === 'whatsapp_conversations'), false);
});

test('permanent campaign history remains manageable after the originating contact is removed', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  const row = await s.create(f.contact.id, request, f.admin);
  f.state.set(Contact, []);
  assert.equal((await s.listAll(page, f.admin)).total, 1);
  assert.equal((await s.events(row.id, page)).total, 1);
  assert.equal((await s.revoke(row.id, { version: 1, reason: 'Contact deleted fixture', confirmed: true }, f.admin)).isActive, false);
});

test('campaign service fails closed on malformed rules, invalid scopes or missing storage', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  await assert.rejects(s.create(f.contact.id, { ...request, shoppingId: f.group.id }, f.admin), status(400));
  await assert.rejects(s.create(f.contact.id, request, { ...f.regular, canDelete: true }), status(403));
  await assert.rejects(s.listAll(page, f.regular), status(403));
  f.seed(Preference, { normalizedPhone: 'invalid', whatsappIdentity: null, connectionId: null, shoppingId: null });
  await assert.rejects(s.snapshot(), status(503));
  t.mock.method(f.repos.get(Preference), 'findAndCount', async () => { throw new Error('mock storage missing'); });
  await assert.rejects(s.listAll(page, f.admin), status(503));
});

test('campaign HTTP routes keep static route priority, authorization, paging and frontend contracts', async (t) => {
  const f = await registrationsFixture(t, true);
  const admin = await f.token(f.admin), regular = await f.token(f.regular);
  const path = '/contacts/' + f.contact.id + '/campaign-preferences';
  assert.equal((await f.call('/contacts/campaign-preferences', { bearer: regular })).status, 403);
  assert.equal((await f.call('/contacts/campaign-preferences', { bearer: admin })).status, 200);
  assert.equal((await f.call(path, { bearer: regular })).status, 200);
  assert.equal((await f.call(path, { bearer: regular, method: 'POST', body: request })).status, 403);
  const created = await f.call(path, { bearer: admin, method: 'POST', body: request });
  assert.equal(created.status, 201);
  assert.equal(created.body.normalizedPhone, '+5511987654321');
  const list = await f.call(path + '?page=1&pageSize=10', { bearer: admin });
  assert.deepEqual(Object.keys(list.body).sort(), ['affectedContacts', 'identities', 'items', 'normalizedPhone', 'page', 'pageSize', 'total']);
  const historyPath = '/contacts/campaign-preferences/' + created.body.id + '/events';
  assert.equal((await f.call(historyPath, { bearer: regular })).body.total, 1);
  const revokePath = '/contacts/campaign-preferences/' + created.body.id + '/revoke';
  assert.equal((await f.call(revokePath, { bearer: regular, method: 'POST', body: { version: 1, reason: 'Fixture reason', confirmed: true } })).status, 403);
  for (const body of [{ version: 1, reason: 'Fixture reason', confirmed: 'true' }, { version: 1, reason: '  ', confirmed: true }, { version: 0, reason: 'Fixture reason', confirmed: true }]) {
    assert.equal((await f.call(revokePath, { bearer: admin, method: 'POST', body })).status, 400);
  }
  assert.equal((await f.call(revokePath, { bearer: admin, method: 'POST', body: { version: 1, reason: 'Fixture reason', confirmed: true } })).status, 201);
  for (const query of ['page=0', 'pageSize=101', 'page=abc', 'unexpected=true']) {
    assert.equal((await f.call(path + '?' + query, { bearer: admin })).status, 400);
  }
});
