require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Global, Module } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { NestFactory } = require('@nestjs/core');
const { DataSource, QueryFailedError } = require('typeorm');
const { configureApplication } = require('../../dist/application');
const { AuthModule } = require('../../dist/auth/auth.module');
const { User } = require('../../dist/users/entities/user.entity');
const { Organization } = require('../../dist/organizations/entities/organization.entity');
const { OrganizationType } = require('../../dist/organization-types/entities/organization-type.entity');
const { Contact } = require('../../dist/contacts/entities/contact.entity');
const { ContactType } = require('../../dist/contact-types/entities/contact-type.entity');
const { ContactDisplaySetting } = require('../../dist/contact-display-settings/entities/contact-display-setting.entity');
const { ContactCampaignPreference: Preference, ContactCampaignPreferenceEvent: PreferenceEvent } = require('../../dist/contacts/entities/contact-campaign-preference.entity');
const { OrganizationTypesModule } = require('../../dist/organization-types/organization-types.module');
const { OrganizationsModule } = require('../../dist/organizations/organizations.module');
const { ContactTypesModule } = require('../../dist/contact-types/contact-types.module');
const { ContactDisplaySettingsModule } = require('../../dist/contact-display-settings/contact-display-settings.module');
const { ContactsModule } = require('../../dist/contacts/contacts.module');

const entities = [User, OrganizationType, Organization, ContactType, Contact, ContactDisplaySetting, Preference, PreferenceEvent];
const copy = (value) => value == null ? value : structuredClone(value);
const matches = (row, where) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);

async function registrationsFixture(t, http = false, extraModules = []) {
  const source = new DataSource({ type: 'mssql', entities, synchronize: false, migrationsRun: false });
  await source.buildMetadatas(); // No initialize() and no real SQL connection.
  const realRepository = source.getRepository.bind(source);
  const realBuilder = source.createQueryBuilder.bind(source);
  const state = new Map(entities.map((entity) => [entity, []]));
  const operations = [], queries = [], identities = [];
  const failures = new Map();
  let normalizationOverflow = false;
  const repos = new Map();
  function seed(entity, data) {
    const row = { id: randomUUID(), isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
    if (entity === Organization) row.parentOrganizationId ??= null;
    if (entity === Contact) {
      row.organizationId ??= null; row.storeName ??= null; row.email ??= null;
    }
    state.get(entity).push(copy(row));
    return copy(row);
  }
  function hydrate(entity, row, options = {}) {
    if (!row) return null;
    const result = copy(row);
    if (entity === User) delete result.passwordHash;
    if (entity === Organization) {
      result.organizationType = copy(state.get(OrganizationType).find((item) => item.id === row.organizationTypeId));
      result.parentOrganization = copy(state.get(Organization).find((item) => item.id === row.parentOrganizationId) ?? null);
    }
    if (entity === Contact) {
      result.contactType = copy(state.get(ContactType).find((item) => item.id === row.contactTypeId));
      result.organization = hydrate(Organization, state.get(Organization).find((item) => item.id === row.organizationId));
    }
    return result;
  }
  function selected(entity, builder) {
    const params = builder.getParameters();
    let rows = state.get(entity).map((row) => hydrate(entity, row));
    if (entity === Contact) {
      if (builder.expressionMap.wheres.some((item) => item.condition === '1 = 0')) return [];
      for (const key of ['organizationId', 'contactTypeId', 'isActive']) {
        if (params[key] !== undefined) rows = rows.filter((row) => row[key] === params[key]);
      }
      if (params.ids) rows = rows.filter((row) => params.ids.includes(row.id));
      if (params.contextIds) rows = rows.filter((row) => row.organizationId && params.contextIds.includes('|' + row.organizationId.toLowerCase() + '|'));
      if (params.contactName) {
        const text = params.contactName.slice(1, -1).replace(/~(.)/g, '$1').toLowerCase();
        rows = rows.filter((row) => row.contactName.toLowerCase().includes(text));
      }
      rows.sort((a, b) => a.contactName.localeCompare(b.contactName) || a.id.localeCompare(b.id));
      if (params.cursorName) rows = rows.filter((row) => row.contactName > params.cursorName || (row.contactName === params.cursorName && row.id > params.cursorId));
    }
    if (entity === Preference) {
      rows = rows.filter((row) => row.sourceContactId === params.contactId || (params.phone && row.normalizedPhone === params.phone) ||
        Object.keys(params).some((key) => /^jid\d+$/.test(key) && row.whatsappIdentity === params[key] && row.connectionId === params['connection' + key.slice(3)]));
    }
    return rows;
  }
  function instrument(builder, entity) {
    const clone = builder.clone.bind(builder);
    builder.clone = () => instrument(clone(), entity);
    function capture() { queries.push({ sql: builder.getSql(), parameters: copy(builder.getParameters()) }); }
    builder.getMany = async () => {
      capture();
      if (normalizationOverflow && entity === Contact) return Array.from({ length: 500 }, (_, index) => ({
        id: randomUUID(), contactName: `Overflow-${index}`, phone: '(11) 98765-4321', storeName: null,
      }));
      const rows = selected(entity, builder);
      const offset = builder.expressionMap.skip ?? 0;
      const size = builder.expressionMap.take ?? builder.expressionMap.limit;
      return rows.slice(offset, size === undefined ? undefined : offset + size);
    };
    builder.getManyAndCount = async () => {
      capture();
      const rows = selected(entity, builder);
      const offset = builder.expressionMap.skip ?? 0;
      const size = builder.expressionMap.take;
      return [rows.slice(offset, size === undefined ? undefined : offset + size), rows.length];
    };
    builder.getRawMany = async () => {
      capture();
      if (!entity) return copy(identities.filter((row) => row.contactId === builder.getParameters().contactId)
        .slice(0, builder.expressionMap.limit).map(({ contactId, ...row }) => row));
      if (entity === Contact) return [...new Set(state.get(Contact).map((row) => row.storeName).filter((name) => name !== null))]
        .slice(0, builder.expressionMap.limit).map((name) => ({ name }));
      return [];
    };
    return builder;
  }
  for (const entity of entities) {
    const repository = {
      create: (data) => ({ ...data }),
      find: async (options = {}) => {
        const rows = state.get(entity).filter((row) => matches(row, options.where)).map((row) => hydrate(entity, row));
        if (options.order) rows.sort((a, b) => {
          for (const [key, direction] of Object.entries(options.order)) {
            const cmp = a[key] instanceof Date ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]));
            if (cmp) return direction === 'DESC' ? -cmp : cmp;
          }
          return 0;
        });
        return rows.slice(options.skip ?? 0, options.take === undefined ? undefined : (options.skip ?? 0) + options.take);
      },
      findOneBy: async (where) => hydrate(entity, state.get(entity).find((row) => matches(row, where))),
      findOne: async (options) => repository.findOneBy(options.where),
      findOneOrFail: async (options) => { const row = await repository.findOne(options); if (!row) throw new Error('Mock row missing'); return row; },
      findOneByOrFail: async (where) => repository.findOneOrFail({ where }),
      existsBy: async (where) => state.get(entity).some((row) => matches(row, where)),
      countBy: async (where) => state.get(entity).filter((row) => matches(row, where)).length,
      findAndCount: async (options = {}) => [await repository.find(options), state.get(entity).filter((row) => matches(row, options.where)).length],
      createQueryBuilder: (alias) => instrument(realRepository(entity).createQueryBuilder(alias), entity),
      save: async (data) => {
        operations.push({ action: 'save', entity: entity.name });
        if (failures.has(entity)) throw failures.get(entity);
        if (entity === Preference && state.get(entity).some((row) => row.isActive &&
          row.normalizedPhone === data.normalizedPhone && row.whatsappIdentity === data.whatsappIdentity &&
          row.connectionId === data.connectionId && row.shoppingId === data.shoppingId)) {
          throw new QueryFailedError('mock', [], Object.assign(new Error('mock duplicate'), { number: 2601 }));
        }
        const previous = state.get(entity).find((row) => row.id === data.id);
        const row = { id: randomUUID(), isActive: true, createdAt: new Date(), updatedAt: new Date(), ...previous, ...copy(data) };
        for (const column of source.getMetadata(entity).columns) {
          if (column.isNullable && row[column.propertyName] === undefined) row[column.propertyName] = null;
        }
        for (const relation of source.getMetadata(entity).relations) delete row[relation.propertyName];
        if (previous) Object.assign(previous, row); else state.get(entity).push(row);
        return hydrate(entity, row);
      },
      update: async (criteria, changes) => {
        operations.push({ action: 'update', entity: entity.name });
        const row = state.get(entity).find((item) => matches(item, criteria));
        if (!row) return { affected: 0 };
        Object.assign(row, Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, typeof value === 'function' ? new Date() : value])));
        return { affected: 1 };
      },
      remove: async (row) => {
        operations.push({ action: 'remove', entity: entity.name });
        state.set(entity, state.get(entity).filter((item) => item.id !== row.id));
      },
    };
    repos.set(entity, repository);
  }
  source.getRepository = (entity) => { assert.ok(repos.has(entity)); return repos.get(entity); };
  source.createQueryBuilder = (...args) => instrument(realBuilder(...args), null);
  source.query = async (sql) => {
    assert.match(sql, /^SELECT /i, 'Isolated fixture never sends real SQL');
    operations.push({ action: 'query', sql }); return sql.includes('profileColumnCount') ? [{ profileColumnCount: 0 }] : [];
  };
  // Snapshot rows only, preserving repository identity across rollbacks.
  source.transaction = async (callback) => {
    const before = [...state].map(([entity, rows]) => [entity, copy(rows)]);
    operations.push({ action: 'transaction' });
    try { return await callback({ getRepository: source.getRepository, query: source.query }); }
    catch (error) { for (const [entity, rows] of before) state.set(entity, rows); throw error; }
  };
  for (const repository of repos.values()) repository.manager = { transaction: source.transaction };
  const groupType = seed(OrganizationType, { name: 'Grupo empresarial' });
  const shoppingType = seed(OrganizationType, { name: 'Shopping' });
  const otherType = seed(OrganizationType, { name: 'Empresa' });
  const group = seed(Organization, { name: 'Grupo exemplo', organizationTypeId: groupType.id });
  const shopping = seed(Organization, { name: 'Shopping exemplo', organizationTypeId: shoppingType.id, parentOrganizationId: group.id });
  const contactType = seed(ContactType, { name: 'Gerente' });
  const contact = seed(Contact, { contactName: 'Contato fictício', phone: '(11) 98765-4321', contactTypeId: contactType.id,
    organizationId: shopping.id, storeName: 'Café Central' });
  const admin = seed(User, { username: 'admin-fixture', isAdmin: true, canDelete: false });
  const regular = seed(User, { username: 'regular-fixture', isAdmin: false, canDelete: false });
  const setting = seed(ContactDisplaySetting, { fieldKey: 'shopping', isVisible: true, displayOrder: 1 });
  const result = { source, state, repos, operations, queries, identities, failures, seed,
    groupType, shoppingType, otherType, group, shopping, contactType, contact, admin, regular, setting,
    overflow: () => { normalizationOverflow = true; } };
  if (!http) return result;
  source.isInitialized = true;
  class FakeDatabaseModule {}
  Global()(FakeDatabaseModule);
  Module({ providers: [{ provide: DataSource, useValue: source }], exports: [DataSource] })(FakeDatabaseModule);
  class TestModule {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, skipProcessEnv: true,
    load: [() => ({ JWT_SECRET: 'registration-fixture-jwt-secret-32-characters', JWT_EXPIRES_IN: 3600,
      CORS_ORIGINS: ['http://localhost:3000'] })] }), FakeDatabaseModule, AuthModule, OrganizationTypesModule,
    OrganizationsModule, ContactTypesModule, ContactDisplaySettingsModule, ContactsModule, ...extraModules] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false, forceCloseConnections: true });
  t.after(() => app.close());
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const jwt = app.get(JwtService);
  result.token = (user) => jwt.signAsync({ sub: user.id, username: user.username, userRevision: user.updatedAt.toISOString() });
  result.app = app;
  result.call = async (url, { bearer, method = 'GET', body } = {}) => {
    const response = await fetch(base + url, { method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return result;
}

module.exports = { registrationsFixture, entities, User, OrganizationType, Organization,
  ContactType, Contact, ContactDisplaySetting, Preference, PreferenceEvent };
