import { DataSource,type DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createDatabaseOptions } from '../config/database';
import { InitialSchema1793016000000 } from './migrations/1793016000000-InitialSchema';
import { UserProfiles1793275200000 } from './migrations/1793275200000-UserProfiles';
import { RecipientSelections1793390400000 } from './migrations/1793390400000-RecipientSelections';

/** No .env loading, no initialization, no migrations at application startup. */
export function migrationDataSource(values:Record<string,string>):DataSource {
  for(const name of ['DB_HOST','DB_PORT','DB_USERNAME','DB_PASSWORD','DB_DATABASE'])if(!values[name])throw new Error('MIGRATION_CONFIG_MISSING');
  if(!/^\d+$/.test(values.DB_PORT)||Number(values.DB_PORT)<1||Number(values.DB_PORT)>65535)throw new Error('MIGRATION_PORT_INVALID');
  for(const name of ['DB_ENCRYPT','DB_TRUST_SERVER_CERTIFICATE'])if(!['true','false'].includes(values[name]))throw new Error('MIGRATION_TLS_CONFIG_REQUIRED');
  const config=new ConfigService({...values,DB_ENCRYPT:values.DB_ENCRYPT==='true',DB_TRUST_SERVER_CERTIFICATE:values.DB_TRUST_SERVER_CERTIFICATE==='true'});
  return new DataSource({...createDatabaseOptions(config),schema:'dbo',migrations:[InitialSchema1793016000000,UserProfiles1793275200000,RecipientSelections1793390400000],migrationsTableName:'whatsgestor_migrations',migrationsTransactionMode:'all',synchronize:false,migrationsRun:false,dropSchema:false} as DataSourceOptions);
}
