const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataExchangeService, DataExchangeModule } = require('../dist/data-exchange/data-exchange.module');
const { planRegistrations, REGISTRATION_COLUMNS } = require('../dist/data-exchange/registration-plan');
const { registrationsFixture, Contact, ContactType, Organization, OrganizationType } = require('./helpers/registrations-fixture.cjs');
const status = code => error => error.getStatus?.() === code;
const row = (values = {}) => ({ Grupo: 'AD', 'Organização / Shopping': 'Shopping Mogi', Loja: 'Americanas', Responsável: 'José', WhatsApp: '11999991234', 'Tipo de contato': 'Lojista', 'E-mail': '', Ativo: 'Sim', ...values });
const organizational = values => row({ Grupo: '', 'Organização / Shopping': '', Loja: '', Responsável: '', WhatsApp: '', 'Tipo de contato': '', Ativo: '', ...values });
function exchange(f) { return new DataExchangeService({ manager: { getRepository: f.source.getRepository }, transaction: f.source.transaction }); }
const counts = f => [OrganizationType, Organization, ContactType, Contact].map(Entity => f.state.get(Entity).length);

test('unified preview is read only, creates all missing registrations atomically and repeated import is idempotent', async t => {
  const f = await registrationsFixture(t), service = exchange(f), before = counts(f);
  const preview = await service.preview(f.admin.id, { rows: [row()] });
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.summary.newGroups, 1); assert.equal(preview.summary.newShoppings, 1);
  assert.equal(preview.summary.newContactTypes, 1); assert.equal(preview.summary.newContacts, 1);
  assert.deepEqual(counts(f), before); assert.equal(f.operations.filter(op => op.action === 'save').length, 0);
  const result = await service.commit(f.admin, preview.id);
  assert.equal(result.imported, 4);
  const group = f.state.get(Organization).find(item => item.name === 'AD');
  const shopping = f.state.get(Organization).find(item => item.name === 'Shopping Mogi');
  const contact = f.state.get(Contact).find(item => item.contactName === 'José');
  assert.equal(shopping.parentOrganizationId, group.id); assert.equal(contact.organizationId, shopping.id); assert.equal(contact.storeName, 'Americanas');
  const after = counts(f), saves = f.operations.filter(op => op.action === 'save').length;
  assert.deepEqual(await service.commit(f.admin, preview.id), result);
  assert.equal(f.operations.filter(op => op.action === 'save').length, saves);
  const repeated = await service.preview(f.admin.id, { rows: [row({ Grupo: ' ad ', 'Organização / Shopping': '  SHOPPING   MOGI ', 'Tipo de contato': ' LOJISTA ', WhatsApp: '+55 (11) 99999-1234' })] });
  assert.equal(repeated.summary.newRecords, 0); assert.equal(repeated.summary.updatedContacts, 0);
  await service.commit(f.admin, repeated.id); assert.deepEqual(counts(f), after);
});

test('organization only rows create no empty contacts; contacts can have no organization or store', async t => {
  const f = await registrationsFixture(t), service = exchange(f), before = f.state.get(Contact).length;
  const preview = await service.preview(f.admin.id, { rows: [organizational({ Grupo: 'AUDIT' }), organizational({ Grupo: 'AD', 'Organização / Shopping': 'Shopping Pelotas' }), row({ Grupo: '', 'Organização / Shopping': '', Loja: '', WhatsApp: '11988881234' })] });
  assert.equal(preview.canConfirm, true); assert.equal(preview.summary.newContacts, 1);
  await service.commit(f.admin, preview.id);
  assert.equal(f.state.get(Contact).length, before + 1);
  const contact = f.state.get(Contact).find(item => item.contactName === 'José'); assert.equal(contact.organizationId, null); assert.equal(contact.storeName, null);
});

test('same shopping names under different groups remain distinct; missing group is ambiguous', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const groupA = f.seed(Organization, { name: 'AD', organizationTypeId: f.groupType.id });
  const groupB = f.seed(Organization, { name: 'AUDIT', organizationTypeId: f.groupType.id });
  const shoppingA = f.seed(Organization, { name: 'Shopping Mogi', organizationTypeId: f.shoppingType.id, parentOrganizationId: groupA.id });
  f.seed(Organization, { name: 'Shopping Mogi', organizationTypeId: f.shoppingType.id, parentOrganizationId: groupB.id });
  const preview = await service.preview(f.admin.id, { rows: [row()] });
  assert.equal(preview.summary.newGroups, 0); assert.equal(preview.summary.newShoppings, 0);
  assert.equal(preview.summary.existingOrganizations, 2);
  await service.commit(f.admin, preview.id);
  assert.equal(f.state.get(Contact).find(item => item.contactName === 'José').organizationId, shoppingA.id);
  const ambiguous = await service.preview(f.admin.id, { rows: [row({ Grupo: '', WhatsApp: '11988881234' })] });
  assert.equal(ambiguous.canConfirm, false); assert.match(ambiguous.rows[0].issues.join(' '), /ambígua/);
});

test('safe updates preserve contact ID, phone formatting, organization and store; blank email/status preserve data', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const values = row({ Grupo: f.group.name, 'Organização / Shopping': f.shopping.name, Loja: f.contact.storeName, WhatsApp: '+5511987654321', Responsável: 'Novo responsável', 'E-mail': 'novo@example.invalid', 'Tipo de contato': 'Supervisor', Ativo: '' });
  const preview = await service.preview(f.admin.id, { rows: [values] });
  assert.equal(preview.summary.updatedContacts, 1); assert.equal(preview.summary.newContacts, 0);
  await service.commit(f.admin, preview.id);
  const contact = f.state.get(Contact).find(item => item.id === f.contact.id);
  assert.equal(contact.contactName, 'Novo responsável'); assert.equal(contact.email, 'novo@example.invalid');
  assert.equal(contact.phone, f.contact.phone); assert.equal(contact.organizationId, f.contact.organizationId); assert.equal(contact.storeName, f.contact.storeName);
  const emptyOptional = await service.preview(f.admin.id, { rows: [{ ...values, 'E-mail': '', Ativo: '' }] });
  assert.equal(emptyOptional.summary.updatedContacts, 0);
  await service.commit(f.admin, emptyOptional.id);
  assert.equal(f.state.get(Contact).find(item => item.id === f.contact.id).email, 'novo@example.invalid');
});

test('conflicting phone links, incomplete contact rows and invalid email prevent the entire batch', async t => {
  const f = await registrationsFixture(t), service = exchange(f), before = counts(f);
  const preview = await service.preview(f.admin.id, { rows: [row(), row({ WhatsApp: '+5511987654321' }), row({ WhatsApp: '11977771234', 'E-mail': 'invalid' }), organizational({ Grupo: 'Group only', Loja: 'Store without contact' })] });
  assert.equal(preview.summary.errorLines, 3); assert.equal(preview.canConfirm, false);
  assert.match(preview.rows[1].issues.join(' '), /vínculo/);
  await assert.rejects(service.commit(f.admin, preview.id), status(400));
  assert.deepEqual(counts(f), before);
});

test('duplicate rows within the file are merged, while contradictory edits are flagged', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const duplicate = await service.preview(f.admin.id, { rows: [row(), row()] });
  assert.equal(duplicate.summary.newContacts, 1); assert.equal(duplicate.summary.newGroups, 1); assert.equal(duplicate.canConfirm, true);
  const conflict = await service.preview(f.admin.id, { rows: [row(), row({ Responsável: 'Outra pessoa' })] });
  assert.equal(conflict.canConfirm, false); assert.match(conflict.rows[1].issues.join(' '), /linhas 2 e 3/);
  const conflictingLinks = await service.preview(f.admin.id, { rows: [row(), row({ Loja: 'Outra loja' })] });
  assert.equal(conflictingLinks.canConfirm, false); assert.match(conflictingLinks.rows[1].issues.join(' '), /mesmo WhatsApp/);
});

test('only unambiguous structural types are proposed and existing classifications are never silently replaced', async t => {
  const fresh = planRegistrations([row()], { organizations: [], organizationTypes: [], contacts: [], contactTypes: [] });
  assert.equal(fresh.summary.newOrganizationTypes, 2); assert.equal(fresh.summary.errorLines, 0);
  assert.deepEqual(fresh.operations.filter(op => op.kind === 'organizationType').map(op => op.data.name), ['Grupo empresarial', 'Shopping']);
  const f = await registrationsFixture(t), service = exchange(f);
  f.seed(Organization, { name: 'AD', organizationTypeId: f.otherType.id });
  const existing = await service.preview(f.admin.id, { rows: [row()] });
  assert.equal(existing.canConfirm, false); assert.match(existing.rows[0].issues.join(' '), /outro tipo/);
});

test('inactive organizational declarations are checked independently of row order', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const preview = await service.preview(f.admin.id, { rows: [row(), organizational({ Grupo: 'AD', Ativo: 'Não' })] });
  assert.equal(preview.canConfirm, false); assert.match(preview.rows[0].issues.join(' '), /inativo/);
});

test('standalone organizations require an explicit configured type when new and preserve that type on reimport', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const values = organizational({ 'Organização / Shopping': 'Unidade sem grupo', Ativo: 'Não' });
  const uncertain = await service.preview(f.admin.id, { rows: [values] }); assert.equal(uncertain.canConfirm, false);
  const explicit = await service.preview(f.admin.id, { rows: [values], standaloneOrganizationTypeId: f.otherType.id });
  assert.equal(explicit.canConfirm, true); await service.commit(f.admin, explicit.id);
  const organization = f.state.get(Organization).find(item => item.name === 'Unidade sem grupo');
  assert.equal(organization.organizationTypeId, f.otherType.id); assert.equal(organization.parentOrganizationId, null); assert.equal(organization.isActive, false);
  const repeated = await service.preview(f.admin.id, { rows: [values] }); assert.equal(repeated.canConfirm, true); assert.equal(repeated.summary.newRecords, 0);
});

test('a changed catalog invalidates the approved plan without silently changing its actions', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const preview = await service.preview(f.admin.id, { rows: [row()] });
  f.seed(Organization, { name: 'AD', organizationTypeId: f.groupType.id }); const before = counts(f);
  await assert.rejects(service.commit(f.admin, preview.id), error => error.getStatus?.() === 409 && error.getResponse().code === 'IMPORT_PREVIEW_CHANGED');
  assert.deepEqual(counts(f), before);
  const replacement = await service.preview(f.admin.id, { rows: [row()], replacePreviewId: preview.id });
  assert.equal(replacement.summary.newGroups, 0); await service.commit(f.admin, replacement.id);
});

test('a failure after the first contact rolls back all new groups, organizations and types; uncertain commit cannot replay', async t => {
  const f = await registrationsFixture(t), service = exchange(f), before = counts(f);
  const preview = await service.preview(f.admin.id, { rows: [row(), row({ Responsável: 'Segundo', WhatsApp: '11988881234' })] });
  const repository = f.repos.get(Contact), save = repository.save; let saved = 0;
  repository.save = async value => { if (++saved === 2) throw new Error('Simulated failure'); return save(value); };
  await assert.rejects(service.commit(f.admin, preview.id), /Simulated/);
  assert.deepEqual(counts(f), before); assert.equal(service.status(f.admin.id, preview.id).state, 'uncertain');
  await assert.rejects(service.commit(f.admin, preview.id), status(409));
});

test('export uses only readable columns and reimport produces no changes, including inactive organizations and contacts without organization', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  f.seed(Organization, { name: 'Grupo inativo', organizationTypeId: f.groupType.id, isActive: false });
  f.seed(Contact, { contactName: 'Independente', phone: '11988881234', contactTypeId: f.contactType.id, isActive: false });
  const exported = await service.export({});
  assert.ok(exported.rows.some(row => row.Grupo === 'Grupo inativo' && row.Ativo === 'Não'));
  for (const values of exported.rows) assert.deepEqual(Object.keys(values), REGISTRATION_COLUMNS);
  assert.ok(!JSON.stringify(exported.rows).includes(f.contact.id));
  const preview = await service.preview(f.admin.id, { rows: exported.rows });
  assert.equal(preview.canConfirm, true); assert.equal(preview.summary.newRecords, 0); assert.equal(preview.summary.updatedContacts, 0); assert.equal(preview.summary.updatedOrganizations, 0);
});

test('administrative permission, preview ownership, expiry and input whitelist are enforced in the service', async t => {
  const f = await registrationsFixture(t), service = exchange(f);
  const preview = await service.preview(f.admin.id, { rows: [row()] });
  await assert.rejects(service.commit(f.regular, preview.id), status(403));
  await assert.rejects(service.commit({ ...f.admin, role: 'tester' }, preview.id), status(403));
  await assert.rejects(service.commit({ ...f.admin, id: f.regular.id }, preview.id), status(404));
  await assert.rejects(service.preview(f.admin.id, { rows: [row({ password: 'not accepted' })] }), status(400));
  service.sessions.get(preview.id).expiresAt = 0; await assert.rejects(service.commit(f.admin, preview.id), status(409));
});

test('HTTP supports scoped multipart previews and only an administrator can confirm; no global parser or service changes', async t => {
  const f = await registrationsFixture(t, true, [DataExchangeModule]);
  f.source.manager.getRepository = f.source.getRepository;
  const admin = await f.token(f.admin), attendant = await f.token(f.regular);
  assert.equal((await f.call('/data-exchange/options')).status, 401);
  assert.equal((await f.call('/data-exchange/options', { bearer: attendant })).status, 200);
  const body = new FormData(); body.append('payload', new Blob([JSON.stringify({ rows: [row()] })], { type: 'application/json' }), 'cadastros.json');
  const response = await fetch((await f.app.getUrl()) + '/data-exchange/preview-file', { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body });
  const preview = await response.json(); assert.equal(response.status, 201, JSON.stringify(preview)); assert.equal(preview.canConfirm, true);
  assert.equal((await f.call(`/data-exchange/${preview.id}/commit`, { bearer: attendant, method: 'POST' })).status, 403);
  assert.equal((await f.call(`/data-exchange/${preview.id}/commit`, { bearer: admin, method: 'POST' })).status, 201);
});
