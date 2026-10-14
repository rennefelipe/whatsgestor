import { join } from 'node:path';

export function migrationFiles(directory: string): string {
  return join(directory, '[0-9]*-!(*.spec|*.test).{ts,js}');
}
