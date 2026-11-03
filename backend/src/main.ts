import 'reflect-metadata';
import { Logger } from '@nestjs/common';

async function main(): Promise<void> {
  try {
    // Import inside the try so environment validation errors are handled too.
    const { startApplication } = await import('./application');
    const app = await startApplication();
    Logger.log(`WhatsGestor Backend iniciado em ${await app.getUrl()}`, 'Bootstrap');
  } catch (error) {
    const occupied = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
    Logger.error(
      occupied
        ? 'Porta ocupada. Nenhum processo existente foi encerrado.'
        : 'Falha ao iniciar o backend. Verifique a configuracao e a disponibilidade do SQL Server.',
      undefined,
      'Bootstrap',
    );
    process.exitCode = 1;
  }
}

void main();
