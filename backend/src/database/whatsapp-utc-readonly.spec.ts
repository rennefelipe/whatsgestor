import { DataSource } from 'typeorm';
import { MssqlParameter } from 'typeorm/driver/sqlserver/MssqlParameter';

// Explicit opt-in: only SELECTs, no fixtures, transactions, migrations or writes.
const describeSql =
  process.env.WHATSGESTOR_SQL_READONLY_TEST === '1' ? describe : describe.skip;

describeSql(
  'SQL Server UTC message/attendance compatibility (read-only)',
  () => {
    let database: DataSource;

    beforeAll(async () => {
      const configured = jest.requireActual<{ default: DataSource }>(
        './data-source',
      ).default;
      database = new DataSource({
        ...configured.options,
        entities: [],
        migrations: [],
        synchronize: false,
        migrationsRun: false,
      });
      await database.initialize();
    }, 15000);

    afterAll(async () => {
      if (database?.isInitialized) await database.destroy();
    });

    it('stores message parameters and hydrates SQL-generated attendance timestamps in the same UTC reference', async () => {
      const stamp = new Date('2026-10-09T16:57:12.000Z');
      const rows = await database.query<
        Array<{
          rawMessageTimestamp: string;
          hydratedTimestamp: Date;
          finishedAt: Date;
          isAfterFinish: number;
        }>
      >(
        `SELECT CONVERT(varchar(30), CAST(@0 AS datetime2), 126) AS rawMessageTimestamp,
        CAST(@0 AS datetime2) AS hydratedTimestamp,
        CAST('2026-10-09T16:57:06.579' AS datetime2) AS finishedAt,
        CASE WHEN CAST(@0 AS datetime2) > CAST('2026-10-09T16:57:06.579' AS datetime2) THEN 1 ELSE 0 END AS isAfterFinish`,
        [new MssqlParameter(stamp, 'datetime2')],
      );
      expect(rows[0].rawMessageTimestamp).toBe('2026-10-09T16:57:12');
      expect(rows[0].hydratedTimestamp.toISOString()).toBe(stamp.toISOString());
      expect(rows[0].finishedAt.toISOString()).toBe('2026-10-09T16:57:06.579Z');
      expect(rows[0].isAfterFinish).toBe(1);
    });

    it('does not treat an older message as later than the attendance finish', async () => {
      const rows = await database.query<Array<{ isAfterFinish: number }>>(
        `SELECT CASE WHEN CAST(@0 AS datetime2) > CAST('2026-10-09T16:57:06.579' AS datetime2) THEN 1 ELSE 0 END AS isAfterFinish`,
        [new MssqlParameter(new Date('2026-10-09T16:57:05Z'), 'datetime2')],
      );
      expect(rows[0].isAfterFinish).toBe(0);
    });
  },
);
