const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { QueryFailedError } = require('typeorm');
const { registrationsFixture, Organization, OrganizationType, Contact, ContactType, ContactDisplaySetting, User } = require('./helpers/registrations-fixture.cjs');
const { OrganizationsService } = require('../dist/organizations/organizations.service');
const { OrganizationTypesService } = require('../dist/organization-types/organization-types.service');
const { ContactTypesService } = require('../dist/contact-types/contact-types.service');
const { ContactDisplaySettingsService } = require('../dist/contact-display-settings/contact-display-settings.service');
const { ContactsService } = require('../dist/contacts/contacts.service');
const { organizationContexts } = require('../dist/contacts/organization-context');
const { normalizeContactPhone, normalizeStoreName, matchesContactPhone } = require('../dist/contacts/contact-normalization');

const service = (f) => new ContactsService(f.repos.get(Contact), f.repos.get(ContactType), f.repos.get(Organization));
const organizations = (f) => new OrganizationsService(f.repos.get(Organization), f.repos.get(OrganizationType), f.repos.get(Contact));
const status = (expected) => (error) => error.getStatus?.() === expected;

test('organization contexts preserve explicit types and flag invalid hierarchies without writes', async (t) => {
  const f = await registrationsFixture(t);
  const rows = await f.repos.get(Organization).find();
  let contexts = organizationContexts(rows);
  assert.equal(contexts.find((row) => row.organizationId === f.shopping.id).group.id, f.group.id);
  assert.equal(contexts.find((row) => row.organizationId === f.shopping.id).shopping.id, f.shopping.id);
  const unknown = f.seed(Organization, { name: 'Shopping is only a name', organizationTypeId: f.otherType.id });
  contexts = organizationContexts(await f.repos.get(Organization).find());
  assert.equal(contexts.find((row) => row.organizationId === unknown.id).shopping, null);
  rows.find((row) => row.id === f.group.id).parentOrganizationId = f.shopping.id;
  contexts = organizationContexts(rows);
  assert.ok(contexts.every((row) => row.hierarchyIssue));
  assert.equal(contexts.find((row) => row.organizationId === f.shopping.id).group, null);
  rows.find((row) => row.id === f.group.id).parentOrganizationId = randomUUID();
  assert.ok(organizationContexts(rows).find((row) => row.organizationId === f.group.id).hierarchyIssue);
  assert.equal(f.operations.length, 0);
});

test('organization mutations validate group/shopping hierarchy, cycles and legacy edits', async (t) => {
  const f = await registrationsFixture(t);
  const s = organizations(f);
  const created = await s.create({ name: 'New shopping fixture', organizationTypeId: f.shoppingType.id, parentOrganizationId: f.group.id });
  assert.equal(created.parentOrganization.id, f.group.id);
  await assert.rejects(s.create({ name: 'Missing group', organizationTypeId: f.shoppingType.id }), status(400));
  await assert.rejects(s.create({ name: 'Nested group', organizationTypeId: f.groupType.id, parentOrganizationId: f.group.id }), status(400));
  await assert.rejects(s.update(f.shopping.id, { parentOrganizationId: f.shopping.id.toUpperCase() }), status(400));
  await assert.rejects(s.update(f.group.id, { organizationTypeId: f.otherType.id }), status(400));
  const a = f.seed(Organization, { name: 'Unknown A', organizationTypeId: f.otherType.id });
  const b = f.seed(Organization, { name: 'Unknown B', organizationTypeId: f.otherType.id, parentOrganizationId: a.id });
  await assert.rejects(s.update(a.id, { parentOrganizationId: b.id }), status(400));
  const legacy = f.seed(Organization, { name: 'Legacy shopping', organizationTypeId: f.shoppingType.id });
  assert.equal((await s.update(legacy.id, { name: 'Renamed legacy' })).parentOrganizationId, null);
  assert.ok(f.operations.some((operation) => operation.sql === 'SELECT TOP (1) [id] FROM [dbo].[organizations] WITH (TABLOCKX,HOLDLOCK)'));
});

test('types and organizations retain protections against reclassification and linked deletion', async (t) => {
  const f = await registrationsFixture(t);
  const types = new OrganizationTypesService(f.repos.get(OrganizationType), f.repos.get(Organization));
  await assert.rejects(types.update(f.groupType.id, { name: 'Empresa' }), status(409));
  assert.equal((await types.update(f.groupType.id, { name: 'Grupo' })).name, 'Grupo');
  await assert.rejects(types.remove(f.groupType.id), status(409));
  await assert.rejects(organizations(f).remove(f.group.id), status(409));
  await assert.rejects(organizations(f).remove(f.shopping.id), status(409));
  const contactTypes = new ContactTypesService(f.repos.get(ContactType), f.repos.get(Contact));
  await assert.rejects(contactTypes.remove(f.contactType.id), status(409));
  const unused = await contactTypes.create({ name: 'Unused fixture type' });
  await contactTypes.updateActive(unused.id, { isActive: false });
  await contactTypes.remove(unused.id);
  assert.equal(f.state.get(ContactType).some((row) => row.id === unused.id), false);
});

test('contact creation allows independent contexts and preserves original phone and store values', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  const original = '(11) 98765-4321';
  const a = await s.create({ contactName: 'Same name', phone: original, contactTypeId: f.contactType.id, organizationId: null, storeName: null });
  const b = await s.create({ contactName: 'Same name', phone: original, contactTypeId: f.contactType.id, organizationId: f.shopping.id, storeName: ' Cafe\u0301  CENTRAL ' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.organization, null);
  assert.equal(a.organizationContext, null);
  assert.equal(b.organizationContext.shopping.id, f.shopping.id);
  assert.equal(b.phone, original);
  assert.equal(b.storeName, ' Cafe\u0301  CENTRAL ');
  f.state.get(ContactType).find((row) => row.id === f.contactType.id).isActive = false;
  f.state.get(Organization).find((row) => row.id === f.shopping.id).isActive = false;
  assert.equal((await s.update(b.id, { contactName: 'Renamed' })).phone, original);
  await assert.rejects(s.create({ contactName: 'Invalid new', phone: original, contactTypeId: f.contactType.id }), status(400));
  const activeType = f.seed(ContactType, { name: 'New active' });
  await assert.rejects(s.create({ contactName: 'Invalid shopping', phone: original, contactTypeId: activeType.id, organizationId: f.shopping.id }), status(400));
  const detached = await s.update(b.id, { organizationId: null, storeName: null, email: null });
  assert.equal(detached.organizationContext, null);
  assert.equal(detached.storeName, null);
});

test('normalization preserves international and Brazilian matching and Unicode store semantics', () => {
  for (const input of ['(11) 98765-4321', '+55 (11) 98765-4321', '005511987654321', '5511987654321@s.whatsapp.net']) {
    assert.equal(normalizeContactPhone(input).normalizedPhone, '+5511987654321');
    assert.equal(matchesContactPhone(input, '11987654321'), true);
  }
  assert.equal(matchesContactPhone('00442079460018', '+44 20 7946 0018'), true);
  assert.equal(matchesContactPhone('+5511987654321', '(11) 987'), true);
  for (const input of ['123@lid', 'abc11987654321', '+5511987654321 ext 2']) assert.equal(normalizeContactPhone(input).normalizedPhone, null);
  assert.equal(normalizeStoreName(' Cafe\u0301\t CENTRAL\u00a0'), 'café central');
  assert.notEqual(normalizeStoreName('Cafe'), normalizeStoreName('Café'));
  assert.notEqual(normalizeStoreName('Ａ'), normalizeStoreName('A'));
  assert.equal(normalizeStoreName(' \t\u2003'), null);
});

test('contact filters use SQL parameters, exact hierarchy membership and optional pagination', async (t) => {
  const f = await registrationsFixture(t);
  const s = service(f);
  assert.ok(Array.isArray(await s.findAll({})));
  const page = await s.findAll({ groupId: f.group.id, shoppingId: f.shopping.id, contactTypeId: f.contactType.id, isActive: true, page: 1, pageSize: 1 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].organizationContext.group.id, f.group.id);
  const query = f.queries.at(-1);
  assert.match(query.sql, /CHARINDEX/);
  assert.equal(query.parameters.contextIds, '|' + f.shopping.id.toLowerCase() + '|');
  assert.equal(query.parameters.isActive, true);
  assert.equal(query.parameters.contactTypeId, f.contactType.id);
  assert.equal((await s.findAll({ shoppingId: randomUUID() })).length, 0);
  const search = "a%_[~' OR 1=1";
  await s.findAll({ contactName: search, search });
  const filtered = f.queries.at(-1);
  assert.equal(filtered.sql.includes(search), false);
  assert.equal(filtered.parameters.contactName, "%a~%~_~[~~' OR 1=1%");
  assert.match(filtered.sql, /ESCAPE '~'/);
  assert.match(filtered.sql, /parentOrganization/);
  assert.equal(f.operations.length, 0);
});

test('phone/store/withoutStore filters normalize before totals and pagination', async (t) => {
  const f = await registrationsFixture(t);
  f.seed(Contact, { contactName: 'Second fixture', phone: '005511987654321', storeName: ' CAFE\u0301\t CENTRAL ', contactTypeId: f.contactType.id, organizationId: f.shopping.id });
  f.seed(Contact, { contactName: 'Without store', phone: '+5511987654321', storeName: ' \u00a0 ', contactTypeId: f.contactType.id });
  const s = service(f);
  const page = await s.findAll({ storeName: 'café central', phone: '+55 (11) 98765-4321', page: 2, pageSize: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].storeName, ' CAFE\u0301\t CENTRAL ');
  assert.equal((await s.findAll({ withoutStore: true })).length, 1);
  assert.equal((await s.findAll({ withoutStore: false })).length, 2);
  const options = await s.options();
  assert.deepEqual(options.storeNames, ['Café Central']);
  assert.equal(options.organizationContexts.length, 2);
  assert.equal(f.operations.length, 0);
});

test('normalized searches reject the scan ceiling instead of returning partial results', async (t) => {
  const f = await registrationsFixture(t);
  f.overflow();
  await assert.rejects(service(f).findAll({ phone: '987' }), status(400));
  assert.equal(f.operations.length, 0);
});

test('display settings preserve order and return 404 for absent settings', async (t) => {
  const f = await registrationsFixture(t);
  const s = new ContactDisplaySettingsService(f.repos.get(ContactDisplaySetting));
  assert.equal((await s.findAll())[0].fieldKey, 'shopping');
  const result = await s.update(f.setting.id, { isVisible: false, displayOrder: 2 });
  assert.equal(result.isVisible, false);
  assert.equal(result.displayOrder, 2);
  await assert.rejects(s.update(randomUUID(), { isVisible: true }), status(404));
});

test('HTTP cadastro contracts require authentication and preserve frontend payloads', async (t) => {
  const f = await registrationsFixture(t, true);
  const bearer = await f.token(f.regular);
  for (const path of ['/organizations', '/organization-types', '/contact-types', '/contact-display-settings', '/contacts', '/contacts/options']) {
    assert.equal((await f.call(path)).status, 401);
    assert.equal((await f.call(path, { bearer })).status, 200);
  }
  assert.ok(Array.isArray((await f.call('/contacts', { bearer })).body));
  const page = await f.call('/contacts?page=1&pageSize=25', { bearer });
  assert.deepEqual(Object.keys(page.body).sort(), ['items', 'page', 'pageSize', 'total']);
  const created = await f.call('/contacts', { bearer, method: 'POST', body: { contactName: 'HTTP fixture', phone: '(11) 98765-4321', contactTypeId: f.contactType.id, organizationId: null, storeName: null, email: null } });
  assert.equal(created.status, 201);
  assert.equal(created.body.organizationId, null);
  assert.equal((await f.call('/contacts/' + created.body.id + '/active', { bearer, method: 'PATCH', body: { isActive: false } })).body.isActive, false);
  assert.equal((await f.call('/contacts/' + created.body.id, { bearer, method: 'PATCH', body: { storeName: 'HTTP store' } })).body.storeName, 'HTTP store');
  const contactType = await f.call('/contact-types', { bearer, method: 'POST', body: { name: 'HTTP type', isActive: true } });
  assert.equal(contactType.status, 201);
  assert.equal((await f.call('/contact-types/' + contactType.body.id, { bearer })).body.name, 'HTTP type');
  assert.equal((await f.call('/contact-types/' + contactType.body.id, { bearer, method: 'PATCH', body: { name: 'Updated type' } })).status, 200);
  assert.equal((await f.call('/contact-types/' + contactType.body.id + '/active', { bearer, method: 'PATCH', body: { isActive: false } })).body.isActive, false);
  assert.equal((await f.call('/contact-display-settings/' + f.setting.id, { bearer, method: 'PATCH', body: { isVisible: false, displayOrder: 3 } })).body.displayOrder, 3);
});

test('HTTP validates UUIDs, booleans, nullability, pagination and delete permissions', async (t) => {
  const f = await registrationsFixture(t, true);
  const bearer = await f.token(f.regular);
  for (const query of ['page=0', 'pageSize=101', 'isActive=yes', 'withoutStore=0', 'groupId=invalid', 'shoppingId=invalid', 'extra=value']) {
    assert.equal((await f.call('/contacts?' + query, { bearer })).status, 400);
  }
  for (const body of [{ contactTypeId: null }, { contactName: null }, { phone: null }, { isActive: 'false' }, { extra: true }]) {
    assert.equal((await f.call('/contacts/' + f.contact.id, { bearer, method: 'PATCH', body })).status, 400);
  }
  assert.equal((await f.call('/organizations/invalid', { bearer })).status, 400);
  assert.equal((await f.call('/contacts/' + randomUUID(), { bearer })).status, 404);
  assert.equal((await f.call('/contact-display-settings/' + f.setting.id, { bearer, method: 'PATCH', body: { displayOrder: 0 } })).status, 400);
  assert.equal((await f.call('/contacts/' + f.contact.id, { bearer, method: 'DELETE' })).status, 403);
  f.state.get(User).find((row) => row.id === f.regular.id).canDelete = true;
  assert.equal((await f.call('/contacts/' + f.contact.id, { bearer, method: 'DELETE' })).status, 403);
  const admin = await f.token(f.admin);
  assert.equal((await f.call('/contacts/' + f.contact.id, { bearer: admin, method: 'DELETE' })).status, 200);
  assert.equal((await f.call('/contacts/' + f.contact.id, { bearer })).status, 404);
});
