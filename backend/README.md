<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Database

Copy `.env.example` to `.env` and set the SQL Server credentials in `.env`.
The real `.env` file is ignored by Git. The application loads entities through
NestJS and keeps TypeORM synchronization disabled; schema changes must be made
with migrations.

Set `JWT_SECRET` to a unique, randomly generated secret before starting the API.
For example, generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`
and place the result in `.env`. `JWT_EXPIRES_IN` configures token lifetime in
seconds (default: `3600`).

Create the first administrator manually, after configuring the database and
building the backend:

```bash
npm run users:bootstrap
```

The command prompts for a username and a masked password, stores a bcrypt hash,
requires at least 8 characters and accepts up to 72 UTF-8 bytes, and refuses
to run if an administrator already exists. It does not run during application
startup.

Authentication endpoints:

- `POST /auth/login` with `{ "username": "...", "password": "..." }`
- `GET /auth/me` with `Authorization: Bearer <token>`

All API routes except login require a valid JWT. `/users` endpoints require an
administrator. DELETE endpoints require an administrator or a user with
`canDelete=true`.

## WhatsApp connections

WhatsApp connections use independent Baileys sessions. All endpoints require a
JWT; creating/editing connection records remains available to authenticated
users. Only administrators can start, disconnect, log out, or view a QR code.
Authenticated users can view connection status:

- `GET /whatsapp-connections`
- `GET /whatsapp-connections/:id`
- `POST /whatsapp-connections` with `{ "name": "...", "isActive": true }`
- `PATCH /whatsapp-connections/:id` with `name` and/or `isActive`
- `PATCH /whatsapp-connections/:id/active` with `{ "isActive": false }`
- `POST /whatsapp-connections/:id/connect` (administrator)
- `GET /whatsapp-connections/:id/qr` (administrator; QR expires after 60 seconds)
- `GET /whatsapp-connections/:id/status` (authenticated)
- `POST /whatsapp-connections/:id/disconnect` (administrator; keeps credentials)
- `POST /whatsapp-connections/:id/logout` (administrator; removes credentials)

Session credentials are stored outside the repository by default under
`~/.whatsgestor/whatsapp-sessions`, in a directory named after each connection
UUID. Set `WHATSAPP_SESSIONS_DIR` to override this location. Restrict access to
this directory and include it in secure backups: anyone who can read the files
may be able to use the WhatsApp session. On Windows, apply restrictive NTFS ACLs
to the configured directory; POSIX file modes are also applied where supported.
Do not copy session data to public storage or log its contents. Connections are
restored at startup only when the connection is active and paired credentials
with a persisted identity already exist; an unpaired connection does not initiate a session
automatically. Reconnection uses a bounded exponential delay. No migration is
needed for the Baileys integration. A manual disconnect is marked in the
connection's private session directory so a backend restart does not reconnect
it; explicitly starting it again removes that marker.

The session manager writes sanitized JSON diagnostic events to the NestJS
application log. Events include the connection UUID, credential-check result,
connection state, numeric disconnect code, normalized cause, retry attempt,
and status updates; QR contents, credentials, keys, phone numbers, file paths,
and raw Baileys errors are intentionally excluded. NestJS shutdown hooks close
managed sockets without logging out or deleting session credentials and wait
for pending credential writes.

Only one backend process should use a given WhatsApp session directory. There
is currently no inter-process lock: running overlapping instances can cause
WhatsApp to replace a connection and can allow concurrent access to session
files. For multi-instance deployment, use a per-connection distributed lease
(for example, a SQL-backed lease with an owner ID and expiry/heartbeat) before
starting sockets; do not share a session directory across active instances
without such ownership coordination.

Apply the table migration manually when ready:

```bash
npm run migration:run
```

Migration file: `src/database/migrations/1791439200000-CreateWhatsappConnections.ts`.

## WhatsApp conversations and messages

The authenticated conversation API supports paging with `page` (default `1`)
and `pageSize` (default `50`, maximum `100`). Conversation lists may be filtered
by `connectionId`. Responses contain `items`, `total`, `page`, and `pageSize`.
Messages are returned chronologically. The Baileys integration persists new
incoming individual-chat text events (`notify`) using the emitting connection's
UUID; history (`append`), sent-by-self, group, status, broadcast, and non-text
messages are ignored. Persistence errors are logged without message contents
and do not interrupt the WhatsApp socket. Unique database indexes and the
internal persistence service prevent repeated events from creating duplicate
conversations or messages. Message sending and media storage are not included.

- `GET /whatsapp-conversations?connectionId=<uuid>&page=1&pageSize=50`
- `GET /whatsapp-conversations/:id`
- `GET /whatsapp-conversations/:id/messages?page=1&pageSize=50`
- `POST /whatsapp-conversations/:id/messages` with `{ "textContent": "..." }`

Text sending uses only the active Baileys socket for the conversation's
connection. The returned message is persisted with status `sent`, meaning
Baileys accepted it; that status is not a delivery or read receipt. If WhatsApp
accepts a send but SQL persistence fails, the API returns an error warning the
caller to check the conversation before retrying. Simultaneous sends to the
same conversation are rejected while one is in progress. This does not provide
exactly-once delivery across process restarts or independent clients.

Apply the conversation and message schema migration manually when ready. It
creates `whatsapp_conversations` and `whatsapp_messages`, referencing the
existing connection and conversation tables without modifying them:

```bash
npm run migration:run
```

Migration file: `src/database/migrations/1791485910429-CreateWhatsappConversationsAndMessages.ts`.

Generate a migration after adding entity changes:

```bash
$ npm run migration:generate -- src/database/migrations/DescribeChange
```

Create an empty migration, run pending migrations, revert the last migration,
or show migration status:

```bash
$ npm run migration:create -- src/database/migrations/DescribeChange
$ npm run migration:run
$ npm run migration:revert
$ npm run migration:show
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
