"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectionDatabaseFixture = void 0;
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// TEST DOUBLE ONLY. Never registered in a Nest module or selected on SQL errors.
// Simulates tables/transactions, not SQL Server syntax, IO or process durability.
const typeorm_1 = require("typeorm");
const recipient_selection_entity_1 = require("../../dist/bulk-send/entities/recipient-selection.entity");
class SelectionDatabaseFixture {
    tables = new Map(recipient_selection_entity_1.recipientSelectionEntities.map((entity) => [entity, new Map()]));
    queue = Promise.resolve();
    available = true;
    beforeInsert;
    match(row, where) {
        if (!where)
            return true;
        if (Array.isArray(where))
            return where.some((part) => this.match(row, part));
        return Object.entries(where).every(([key, value]) => {
            if (value instanceof typeorm_1.FindOperator) {
                if (value.type === 'isNull')
                    return row[key] == null;
                if (value.type === 'moreThan')
                    return row[key] > value.value;
                if (value.type === 'not')
                    return !this.match(row, { [key]: value.child ?? value.value });
            }
            return row[key] === value;
        });
    }
    repository(entity, getTables) {
        const table = () => {
            if (!this.available)
                throw new Error('Fixture: SQL unavailable');
            return getTables().get(entity);
        };
        const find = (options = {}) => {
            let rows = [...table().values()].filter((row) => this.match(row, options.where));
            const total = rows.length;
            for (const [key, order] of Object.entries(options.order ?? {}).reverse())
                rows = rows.sort((a, b) => {
                    const left = a[key] instanceof Date ? a[key].getTime() : a[key], right = b[key] instanceof Date ? b[key].getTime() : b[key];
                    return ((left < right ? -1 : left > right ? 1 : 0) *
                        (order === 'DESC' ? -1 : 1));
                });
            rows = rows.slice(options.skip ?? 0, options.take === undefined
                ? undefined
                : (options.skip ?? 0) + options.take);
            return { items: structuredClone(rows), total };
        };
        const unique = (row) => {
            const other = [...table().values()].filter((item) => item.id !== row.id);
            const duplicate = table().has(row.id) ||
                (entity === recipient_selection_entity_1.RecipientSelection &&
                    row.slot != null &&
                    other.some((item) => item.ownerId === row.ownerId && item.slot === row.slot)) ||
                (entity === recipient_selection_entity_1.RecipientSelectionOperation &&
                    other.some((item) => item.ownerId === row.ownerId && item.requestId === row.requestId)) ||
                (entity === recipient_selection_entity_1.RecipientSelectionItem &&
                    other.some((item) => item.revisionId === row.revisionId &&
                        item.contextKey === row.contextKey &&
                        item.selected === row.selected)) ||
                (entity === recipient_selection_entity_1.RecipientSelectionSource &&
                    other.some((item) => item.itemId === row.itemId && item.contactId === row.contactId));
            if (duplicate)
                throw Object.assign(new Error('Fixture unique constraint'), {
                    driverError: { number: 2627 },
                });
        };
        const update = (where, changes) => {
            let affected = 0;
            for (const row of table().values())
                if (this.match(row, where)) {
                    Object.assign(row, structuredClone(changes));
                    affected++;
                }
            return Promise.resolve({ affected });
        };
        const builder = {
            update: () => builder,
            set: (changes) => {
                builder.changes = changes;
                return builder;
            },
            where: (_sql, parameters) => {
                builder.parameters = parameters;
                return builder;
            },
            changes: {},
            parameters: {},
            execute: () => {
                let affected = 0;
                for (const row of table().values())
                    if (row.ownerId === builder.parameters.ownerId &&
                        !row.retained &&
                        row.expiresAt <= builder.parameters.now) {
                        Object.assign(row, builder.changes);
                        affected++;
                    }
                return Promise.resolve({ affected });
            },
        };
        return {
            create: (row) => ({ ...row }),
            find: (options) => Promise.resolve(find(options).items),
            findAndCount: (options) => {
                const result = find(options);
                return Promise.resolve([result.items, result.total]);
            },
            findOne: (options) => Promise.resolve(find({ ...options, take: 1 }).items[0] ?? null),
            findOneBy: (where) => Promise.resolve(find({ where, take: 1 }).items[0] ?? null),
            insert: async (data) => {
                const rows = Array.isArray(data) ? data : [data];
                await this.beforeInsert?.(entity, rows);
                for (const value of rows) {
                    const row = { createdAt: new Date(), ...structuredClone(value) };
                    unique(row);
                    table().set(row.id, row);
                }
                return { identifiers: [] };
            },
            update,
            createQueryBuilder: () => builder,
        };
    }
    asDataSource() {
        const getRepository = (entity) => this.repository(entity, () => this.tables);
        return {
            getRepository,
            manager: { getRepository },
            transaction: async (work) => {
                const previous = this.queue;
                let release;
                this.queue = new Promise((resolve) => {
                    release = resolve;
                });
                await previous;
                // structuredClone cannot preserve class constructor map keys.
                const transactionTables = new Map([...this.tables].map(([entity, rows]) => [
                    entity,
                    structuredClone(rows),
                ]));
                try {
                    const result = await work({
                        getRepository: (entity) => this.repository(entity, () => transactionTables),
                    });
                    this.tables = transactionTables;
                    return result;
                }
                finally {
                    release();
                }
            },
        };
    }
}
exports.SelectionDatabaseFixture = SelectionDatabaseFixture;
