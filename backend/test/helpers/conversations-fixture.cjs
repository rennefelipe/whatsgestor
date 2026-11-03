const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource, QueryFailedError } = require('typeorm');
const { Global, Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigModule } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { registrationsFixture, entities: registrationEntities, Contact, User } = require('./registrations-fixture.cjs');
const { AuthModule } = require('../../dist/auth/auth.module');
const { configureApplication } = require('../../dist/application');
const { WhatsappConversation: Conversation } = require('../../dist/whatsapp-conversations/entities/whatsapp-conversation.entity');
const { WhatsappMessage: Message } = require('../../dist/whatsapp-conversations/entities/whatsapp-message.entity');
const { WhatsappMessageMedia: Media } = require('../../dist/whatsapp-conversations/entities/whatsapp-message-media.entity');
const { WhatsappConversationsModule } = require('../../dist/whatsapp-conversations/whatsapp-conversations.module');
const { WhatsappConversationsService } = require('../../dist/whatsapp-conversations/whatsapp-conversations.service');
const { WhatsappAttendanceService } = require('../../dist/whatsapp-conversations/whatsapp-attendance.service');
const { ConversationMessageRecordsService } = require('../../dist/whatsapp-conversations/conversation-message-records.service');
const entities = [...registrationEntities, Conversation, Message, Media];
const copy = (row) => row == null ? row : structuredClone(row);
const match = (row, where) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
const time = (value, fallback) => value?.getTime() ?? fallback;

async function conversationsFixture(t, http = false, settings = {}) {
  const f = await registrationsFixture(t);
  const metadata = new DataSource({ type: 'mssql', entities, synchronize: false, migrationsRun: false });
  await metadata.buildMetadatas(); // Generates real SQL only; never initialize this source.
  for (const entity of [Conversation, Message, Media]) f.state.set(entity, []);
  const rows = (entity) => f.state.get(entity);
  const writes = [], locks = [], queries = [], transactions = [];
  const faults = new Map(), tails = new Map();
  const connectionId = randomUUID(), connectionIds = new Set([connectionId]);
  const other = f.seed(User, { username: 'other-fixture', isAdmin: false, canDelete: false });
  function seedConversation(data = {}) {
    return f.seed(Conversation, { connectionId, remoteJid: randomUUID() + '@lid', contactName: null,
      contactId: null, assignedUserId: null, attendanceStatus: 'waiting',
      attendanceStartedAt: null, attendanceFinishedAt: null, lastMessageAt: null, ...data });
  }
  const conversation = seedConversation();
  const project = (entity, row) => {
    if (!row) return null;
    const result = Object.fromEntries(metadata.getMetadata(entity).columns
      .filter((column) => column.isSelect).map((column) => [column.propertyName, copy(row[column.propertyName])]));
    if (entity === Conversation) {
      const contact = rows(Contact).find((item) => item.id === row.contactId);
      const user = rows(User).find((item) => item.id === row.assignedUserId);
      result.contact = contact ? { id: contact.id, contactName: contact.contactName } : null;
      result.assignedUser = user ? { id: user.id, username: user.username } : null;
    }
    if (entity === Message) {
      const media = rows(Media).find((item) => item.messageId === row.id);
      result.media = media ? Object.fromEntries(['id', 'kind', 'availability', 'mimeType', 'originalName', 'sizeBytes', 'durationSeconds'].map((key) => [key, media[key]])) : null;
    }
    return result;
  };
  function builder(entity) {
    const query = entity ? metadata.getRepository(entity).createQueryBuilder(entity === Conversation ? 'conversation' : 'message') : metadata.createQueryBuilder();
    function selected() {
      const params = query.getParameters();
      let selected = [...rows(entity)];
      if(params.conversationIds){
        selected=selected.filter(row=>params.conversationIds.includes(row.conversationId));
        if(query.getSql().includes('SELECT TOP(1)')){
          const latest=new Map();for(const row of selected){const previous=latest.get(row.conversationId);
            const rank=value=>[time(value.messageTimestamp??value.createdAt,0),time(value.createdAt,0),value.id];
            const a=rank(row),b=previous&&rank(previous);
            if(!previous||a[0]>b[0]||a[0]===b[0]&&(a[1]>b[1]||a[1]===b[1]&&a[2]>b[2]))latest.set(row.conversationId,row);
          }selected=[...latest.values()];
        }
      }
      for (const key of ['id', 'connectionId', 'attendanceStatus', 'assignedUserId', 'contactId', 'conversationId']) {
        if (params[key] !== undefined) selected = selected.filter((row) => row[key] === params[key]);
      }
      if (params.search) {
        const text = params.search.slice(1, -1).replace(/~(.)/g, '$1').toLowerCase();
        selected = selected.filter((row) => [row.contactName, row.remoteJid, project(entity, row).contact?.contactName,
          project(entity, row).assignedUser?.username].some((value) => value?.toLowerCase().includes(text)));
      }
      if (entity === Conversation) selected.sort((a, b) => time(b.lastMessageAt, -Infinity) - time(a.lastMessageAt, -Infinity) ||
        time(b.createdAt, 0) - time(a.createdAt, 0) || a.id.localeCompare(b.id));
      if (entity === Message) selected.sort((a, b) => time(a.messageTimestamp, Infinity) - time(b.messageTimestamp, Infinity) ||
        time(a.createdAt, 0) - time(b.createdAt, 0) || a.id.localeCompare(b.id));
      return selected.map((row) => project(entity, row));
    }
    const capture = () => queries.push({ sql: query.getSql(), parameters: copy(query.getParameters()) });
    query.getOne = async () => { capture(); return selected()[0] ?? null; };
    query.getMany = async () => { capture(); return selected(); };
    query.getManyAndCount = async () => {
      capture(); const items = selected(), offset = query.expressionMap.skip ?? 0;
      return [items.slice(offset, offset + (query.expressionMap.take ?? items.length)), items.length];
    };
    query.getRawOne = async () => {
      capture(); const id = query.getParameters().connectionId;
      return connectionIds.has(id) ? { id } : undefined;
    };
    return query;
  }
  const repos = f.repos;
  for (const entity of [Conversation, Message, Media]) {
    const repository = {
      create: (values) => Object.assign(new entity(), values),
      createQueryBuilder: () => builder(entity),
      findOne: async (options) => {
        const row = rows(entity).find((row) => match(row, options.where));
        const result = project(entity, row);
        if (result && options.select?.storageKey === true) result.storageKey = row.storageKey;
        return result;
      },
      findOneBy: async (where) => project(entity, rows(entity).find((row) => match(row, where))),
      save: async (values) => {
        if (faults.has(entity)) throw faults.get(entity);
        if (entity === Conversation && rows(entity).some((row) => row.id !== values.id && row.connectionId === values.connectionId && row.remoteJid === values.remoteJid) ||
          entity === Message && rows(entity).some((row) => row.id !== values.id && row.conversationId === values.conversationId && row.whatsappMessageId === values.whatsappMessageId && row.fromMe === values.fromMe) ||
          entity === Media && rows(entity).some((row) => row.id !== values.id && row.messageId === values.messageId)) {
          throw new QueryFailedError('isolated fixture', [], Object.assign(new Error('duplicate fixture'), { number: 2627 }));
        }
        const row = { createdAt: new Date(), updatedAt: new Date(), ...copy(values), id: values.id ?? randomUUID() };
        for (const column of metadata.getMetadata(entity).columns) if (row[column.propertyName] === undefined && column.isNullable) row[column.propertyName] = null;
        for (const relation of metadata.getMetadata(entity).relations) delete row[relation.propertyName];
        const previous = rows(entity).find((item) => item.id === row.id);
        if (previous) Object.assign(previous, row); else rows(entity).push(row);
        writes.push({ entity: entity.name, action: 'save', id: row.id });
        return project(entity, row);
      },
      update: async (where, changes) => {
        if (faults.has(entity)) throw faults.get(entity);
        const row = rows(entity).find((item) => typeof where === 'string' ? item.id === where : match(item, where));
        if (!row) return { affected: 0 };
        for (const [key, value] of Object.entries(changes)) row[key] = typeof value === 'function' ? new Date() : copy(value);
        writes.push({ entity: entity.name, action: 'update', id: row.id, fields: Object.keys(changes) });
        return { affected: 1 };
      },
    };
    repos.set(entity, repository);
  }
  async function acquire(key) {
    const previous = tails.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    tails.set(key, tail);
    await previous;
    return () => { release(); if (tails.get(key) === tail) tails.delete(key); };
  }
  const database = {
    query: async (sql) => { assert.match(sql, /profileColumnCount/); return [{ profileColumnCount: 0 }]; },
    options: { type: 'mssql' }, entityMetadatas: metadata.entityMetadatas, isInitialized: true,
    getRepository: (entity) => repos.get(entity), createQueryBuilder: () => builder(null),
    transaction: async (isolationOrWork, callback) => {
      const work = typeof isolationOrWork === 'function' ? isolationOrWork : callback;
      transactions.push(typeof isolationOrWork === 'string' ? isolationOrWork : 'default');
      const releases = [], acquired = new Set(), undo = [];
      const manager = {
        query: database.query,
        createQueryBuilder: () => builder(null),
        getRepository: (entity) => {
          const base = repos.get(entity), repository = Object.create(base);
          repository.findOne = async (options) => {
            if (options.lock) locks.push({ entity: entity.name, mode: options.lock.mode, where: copy(options.where) });
            if ((entity === Conversation || entity === Message) && options.lock?.mode === 'pessimistic_write') {
              const existing = rows(entity).find((row) => match(row, options.where));
              const key = (entity === Message ? 'message:' : '') + (options.where.id ?? existing?.id ?? `${options.where.connectionId}|${options.where.remoteJid}`);
              if (!acquired.has(key)) { releases.push(await acquire(key)); acquired.add(key); }
            }
            return base.findOne(options);
          };
          repository.save = async (values) => {
            const before = copy(rows(entity).find((row) => row.id === values.id));
            const saved = await base.save(values);
            undo.push(() => { f.state.set(entity, rows(entity).filter((row) => row.id !== saved.id)); if (before) rows(entity).push(before); });
            return saved;
          };
          repository.update = async (where, changes) => {
            const before = copy(rows(entity).find((row) => typeof where === 'string' ? row.id === where : match(row, where)));
            const result = await base.update(where, changes);
            if (before) undo.push(() => { f.state.set(entity, rows(entity).filter((row) => row.id !== before.id)); rows(entity).push(before); });
            return result;
          };
          return repository;
        },
      };
      try { return await work(manager); }
      catch (error) { for (const revert of undo.reverse()) revert(); throw error; }
      finally { for (const release of releases.reverse()) release(); }
    },
  };
  const result = { ...f, database, metadata, connectionId, connectionIds, other, conversation, seedConversation,
    queries, locks, writes, transactions, faults,
    attendance: new WhatsappAttendanceService(database),
    conversations: new WhatsappConversationsService(repos.get(Conversation), repos.get(Message), database),
    records: new ConversationMessageRecordsService(database),
  };
  if (!http) return result;
  class DatabaseModule {}
  Global()(DatabaseModule);
  Module({ providers: [{ provide: DataSource, useValue: database }], exports: [DataSource] })(DatabaseModule);
  class TestModule {}
  const { MessagesModule } = require('../../dist/messages/messages.module');
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, skipProcessEnv: true,
    load: [() => ({ ...settings, JWT_SECRET: 'conversation-fixture-only-jwt-secret-32-characters', JWT_EXPIRES_IN: 3600, CORS_ORIGINS: ['http://localhost:3000'] })] }),
    DatabaseModule, AuthModule, WhatsappConversationsModule, MessagesModule,
    ...(settings.STAGE6_INTEGRATION ? [require('../../dist/whatsapp-integration/whatsapp-integration.module').WhatsappIntegrationModule] : [])] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false, forceCloseConnections: true });
  t.after(() => app.close()); configureApplication(app); await app.listen(0, '127.0.0.1');
  assert.notEqual(app.getHttpServer().address().port, 3001);
  const url = await app.getUrl(), jwt = app.get(JwtService);
  result.app = app; result.token = (user) => jwt.signAsync({ sub: user.id, username: user.username, userRevision: user.updatedAt.toISOString() });
  result.call = async (path, { bearer, method = 'GET', body } = {}) => {
    const response = await fetch(url + path, { method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return result;
}
module.exports = { conversationsFixture, entities, Conversation, Message, Media, Contact, User };
