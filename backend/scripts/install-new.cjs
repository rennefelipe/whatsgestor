// New Windows installation only. No Nest application, sockets or WhatsApp SDK startup.
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const { parse } = require('dotenv');
const database = require('./database.cjs');

function sqlOptions(values, databaseName = 'master') {
  return { server: values.DB_HOST, port: Number(values.DB_PORT),
    user: values.DB_USERNAME, password: values.DB_PASSWORD, database: databaseName,
    connectionTimeout: 15000, requestTimeout: 60000,
    options: { encrypt: values.DB_ENCRYPT === 'true',
      trustServerCertificate: values.DB_TRUST_SERVER_CERTIFICATE === 'true' } };
}

// Quote without interpreting passwords, #, whitespace or Windows backslashes.
function envLine(key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) throw Error('ENV_VALUE_INVALID');
  const quote = ["'", '"', '`'].find(character => !value.includes(character));
  if (!quote) throw Error('ENV_VALUE_QUOTES_UNSUPPORTED');
  return `${key}=${quote}${value}${quote}\n`;
}

async function resolveInstance(values, connect = options => new sql.ConnectionPool(options).connect()) {
  if (!values.WG_SQL_INSTANCE) return values;
  const options = sqlOptions(values);
  delete options.port;
  options.options.instanceName = values.WG_SQL_INSTANCE;
  const pool = await connect(options);
  try {
    const result = await pool.request().query("SELECT CONVERT(int, CONNECTIONPROPERTY('local_tcp_port')) AS [port]");
    const port = Number(result.recordset[0]?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('INSTANCE_TCP_PORT_UNAVAILABLE');
    return { ...values, DB_PORT: String(port) };
  } finally { await pool.close(); }
}

async function provision(options, dependencies = {}) {
  const values = database.target({ ...options, action: 'migrate' });
  if (!options.apply) throw Error('APPLY_REQUIRED');
  const password = process.env.WG_INITIAL_ADMIN_PASSWORD;
  if (!options.username?.trim() || options.username.length > 100 || !password ||
      password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw Error('BOOTSTRAP_REQUIRES_USERNAME_AND_STRONG_PASSWORD');
  const connect = dependencies.connect ?? (settings => new sql.ConnectionPool(settings).connect());
  const main = dependencies.main ?? database.main;
  let created = false;
  const master = await connect(sqlOptions(values));
  try {
    const result = await master.request().input('name', sql.NVarChar(128), values.DB_DATABASE)
      .query('SELECT DB_ID(@name) AS [id]');
    if (!result.recordset[0]?.id) {
      if (values.DB_DATABASE.length > 128) throw Error('DATABASE_NAME_TOO_LONG');
      // SQL identifiers cannot be parameterized. Escape closing brackets explicitly.
      const quoted = '[' + values.DB_DATABASE.replaceAll(']', ']]') + ']';
      await master.request().query('CREATE DATABASE ' + quoted);
      created = true;
    }
  } finally { await master.close(); }
  // Refuse unversioned or unknown existing schemas before any migration.
  const common = ['--config', options.config, '--database', options.database];
  await main(['plan', ...common]);
  await main(['migrate', ...common, '--apply']);
  const pool = await connect(sqlOptions(values, values.DB_DATABASE));
  let empty;
  try {
    const result = await pool.request().query(`SELECT COUNT_BIG(*) AS [total],
      COALESCE(SUM(CASE WHEN [isAdmin]=1 AND [isActive]=1 AND [role]=N'administrator' THEN 1 ELSE 0 END),0) AS [admins]
      FROM [dbo].[users]`);
    empty = Number(result.recordset[0].total) === 0;
    if (!empty && Number(result.recordset[0].admins) === 0) throw Error('EXISTING_USERS_WITHOUT_ACTIVE_ADMIN_REQUIRES_REVIEW');
  } finally { await pool.close(); }
  if (empty) await main(['bootstrap', ...common, '--username', options.username, '--apply']);
  return { databaseCreated: created, initialAdminCreated: empty, existingUsersPreserved: !empty };
}

async function main(argv = process.argv.slice(2)) {
  const action = argv.shift();
  if (action === 'resolve-instance') {
    if (argv.length !== 1) throw Error('CONFIG_REQUIRED');
    const file = path.resolve(argv[0]);
    if (file.toLowerCase() === path.resolve(__dirname, '../.env').toLowerCase()) throw Error('LIVE_ENV_CANNOT_BE_TARGET_FILE');
    const parsed = parse(fs.readFileSync(file));
    database.target({ action: 'plan', config: file, database: parsed.DB_DATABASE });
    const values = await resolveInstance(parsed);
    fs.writeFileSync(file, Object.entries(values).map(([key, value]) => envLine(key, value)).join(''));
    return;
  }
  if (action !== 'provision') throw Error('UNKNOWN_INSTALL_ACTION');
  const options = database.args(['migrate', ...argv]);
  if (options['maintenance-approved']) throw Error('INSTALLER_CANNOT_OVERRIDE_LIVE_DATABASE_PROTECTION');
  console.log(JSON.stringify(await provision(options)));
}

module.exports = { sqlOptions, envLine, resolveInstance, provision, main };
if (require.main === module) main().catch(error => {
  const safe = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'INSTALL_DATABASE_FAILED';
  // The code identifies the stage without logging SQL credentials or driver messages.
  console.error(safe);
  if (safe === 'INSTALL_DATABASE_FAILED') console.error('Confira TCP/IP, SQL Browser (instancia nomeada), TLS, login SQL e permissoes CREATE DATABASE/DDL no destino.');
  process.exitCode = 1;
});
