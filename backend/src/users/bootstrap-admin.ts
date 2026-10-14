import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import dataSource from '../database/data-source';
import { User } from './entities/user.entity';
import { hashPassword } from './password-hash';

function readHiddenPassword(): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(
      new Error('O bootstrap deve ser executado em um terminal interativo.'),
    );
  }

  stdout.write('Senha (mínimo 8 caracteres): ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let password = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Bootstrap cancelado.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(password);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          password += character;
          stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function bootstrapAdmin(): Promise<void> {
  const prompt = createInterface({ input: stdin, output: stdout });
  const username = (
    await prompt.question('Username do administrador: ')
  ).trim();
  prompt.close();
  if (!username || username.length > 100) {
    throw new Error('O username deve conter entre 1 e 100 caracteres.');
  }
  const password = await readHiddenPassword();
  if (password.length < 8) {
    throw new Error('A senha deve ter pelo menos 8 caracteres.');
  }

  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT TOP (1) [id] FROM [users] WITH (TABLOCKX, HOLDLOCK)',
      );
      const users = manager.getRepository(User);
      if ((await users.countBy({ isAdmin: true })) > 0) {
        throw new Error(
          'Já existe um administrador cadastrado; o bootstrap inicial foi bloqueado.',
        );
      }
      const passwordHash = await hashPassword(password);
      await users.save(
        users.create({
          username,
          passwordHash,
          isAdmin: true,
          canDelete: true,
          isActive: true,
        }),
      );
    });
  } finally {
    await dataSource.destroy();
  }
  stdout.write(`Administrador "${username}" criado com sucesso.\n`);
}

bootstrapAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Falha ao criar administrador.';
  console.error(message);
  process.exitCode = 1;
});
