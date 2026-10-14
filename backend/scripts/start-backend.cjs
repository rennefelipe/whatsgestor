// NODE_EXTRA_CA_CERTS must be present when the child Node process starts.
// Loading it inside Nest/ConfigModule is too late for Node's trust store.
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
require('dotenv').config({ path: resolve(root, '.env'), quiet: true });
const cli = require.resolve('@nestjs/cli/bin/nest.js');
const commands = {
  start: [cli, 'start'],
  dev: [cli, 'start', '--watch'],
  debug: [cli, 'start', '--debug', '--watch'],
  prod: [resolve(root, 'dist/main.js')],
  transport: [resolve(root, 'docs/diagnose-whatsapp-transport.cjs')],
};
const args = commands[process.argv[2]];
if (!args) throw new Error('Unknown backend launch mode');
const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit', shell: false });
child.on('error', () => { console.error('Backend process could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
