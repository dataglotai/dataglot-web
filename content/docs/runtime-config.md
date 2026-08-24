+++
title = "Runtime configuration (SQL DDL)"
description = "Manage catalogs, secrets, users, roles, and governance rules at runtime over SQL — no config file, no restart."
weight = 50
+++

Dataglot manages its catalogs, secrets, users, and governance rules
as objects in a durable **meta store** that you create, alter,
and drop **at runtime with SQL DDL** over the Postgres wire protocol — no config
file, no restart. Only a small **bootstrap** config (what the process needs
before it can accept a connection: bind address, TLS, auth mode, and where the
meta store lives) stays as flags/env/file. Everything else — every source, every
credential, every mask — is `CREATE`d against a running server and survives a
restart because it lives in the store.

This guide takes you from a cold binary to a running server you administer
entirely over `psql`. For the field-by-field reference of the bootstrap config,
see the [configuration reference](/docs/configuration/).

## 1. The idea

The **meta store is the single source of truth** for catalogs, secrets, users,
roles, and governance rules. You mutate it with SQL DDL (`CREATE / ALTER / DROP
CATALOG`, `CREATE / DROP SECRET`, `CREATE / ALTER / DROP USER`, `CREATE / DROP
MASK`, …) against a running server, and the change propagates to live sessions
immediately. The only things that must be decided *before* the server can accept
a connection — the listen address and port, ingress TLS, the authentication
mode, and the meta-store location — stay in a small bootstrap config
(file/flags/env). There is no large config file describing your sources.

## 2. Boot

You need two things to boot: a **bootstrap config** telling the server where its
meta store lives, and (if you want secrets or password logins) a
**`DATAGLOT_SECRET_KEY`**.

### Bootstrap config

The bootstrap config is a small TOML file. The one field that matters for
SQL-native operation is `catalog_service` — the meta store. Two backends:

**Embedded store (zero external dependencies — the default):** a pure-Rust,
crash-safe atomic-file store. Perfect for a single node or local development.

```toml
host = "127.0.0.1"
port = 5432

[catalog_service]
path = "/var/lib/dataglot/meta.redb"
```

**Postgres store (HA / multi-node):** point every node at the same catalog
database and they share one control plane.

```toml
host = "0.0.0.0"
port = 5432

[catalog_service]
dsn = "host=catalog-db port=5432 user=dataglot dbname=dataglot_meta"
org_id = "default"
```

Start the server with the config:

```bash
dataglot --config bootstrap.toml
```

You can generate a commented starter with `dataglot --print-example-config`
(or `dataglot init`). Started against an empty store, the server boots with
**no catalogs** and prints a banner telling you so — that is expected; you
`CREATE CATALOG` into it next.

### The secret key

`CREATE SECRET` and `CREATE USER … PASSWORD` encrypt their payloads before they
reach the store (see [Authentication](#4-authentication) and the secrets
subsection). That requires a 256-bit envelope key, supplied base64-encoded in
the `DATAGLOT_SECRET_KEY` environment variable:

```bash
export DATAGLOT_SECRET_KEY="$(openssl rand -base64 32)"   # 32 bytes, base64
dataglot --config bootstrap.toml
```

Without the key, the server still boots and serves inline (`dsn` / `dsn_env`)
catalogs, but any statement that needs to encrypt a value — `CREATE SECRET`,
`CREATE USER … PASSWORD` — is refused with a clear error. Keep the key stable
across restarts: it decrypts what is already stored.

### Connecting with `psql`

Connect with any Postgres client. The **database name is a catalog name**, not a
credential — Dataglot routes `dbname=pg` so unqualified names resolve against the
`pg` catalog. When the store is still empty (no catalogs yet), connect to the
built-in bootstrap database **`dataglot`**:

```bash
# First connection, before any catalog exists:
psql -h 127.0.0.1 -p 5432 -U admin -d dataglot

# Later, to make `pg` the default catalog for unqualified names:
psql -h 127.0.0.1 -p 5432 -U admin -d pg
```

You can always use fully qualified `catalog.schema.table` names regardless of
which database you connected to.

## 3. The DDL surface

Every statement below is detected at the wire boundary *before* planning and
routed to the control plane; it takes effect immediately and is persisted to the
meta store. Keywords are case-insensitive and a single trailing `;` is tolerated
throughout. Identifiers are bare (`pg`) or double-quoted (`"My Catalog"`); quoted
values keep spaces and `=` intact, and a doubled quote (`''`) is one literal
quote.

### `CREATE / ALTER / DROP CATALOG`

A catalog is a federated data source. The grammar is an option
bag (not Postgres `CREATE SERVER`):

```text
CREATE [OR REPLACE] CATALOG [IF NOT EXISTS] <name> WITH ( <key> = <value> [, ...] )
ALTER  CATALOG <name> WITH ( <key> = <value> [, ...] )    -- replaces the whole option set
DROP   CATALOG [IF EXISTS] <name>
```

The option bag must include `kind`, which selects the connector. Most options
are scalar strings, which covers the flat-string DSN connectors — `postgres`,
`mysql`, `oracle`, `snowflake`. A `kind` the option bag can't express is rejected
with a clear error.

#### Nested-config sources

Some sources need nested config rather than flat scalars: `object_storage` takes a
`tables` **array** (and an optional `s3` **object**), `warehouse` a nested
`credentials` **object**, `rest` a `tables` array. Give any such value as a
**quoted JSON string** — an option value whose (trimmed) text starts with `[` or
`{` is parsed as JSON; everything else stays a literal string, so DSNs, ports, and
other scalars are unaffected. Malformed JSON on a `[`/`{`-prefixed value is
rejected with an error naming the option.

```sql
-- object_storage: one CSV table read straight from local disk (fully fileless):
CREATE CATALOG files WITH (
  kind = 'object_storage',
  tables = '[{"name":"t","url":"file:///data/t.csv","format":"csv"}]'
);
SELECT * FROM files.public.t LIMIT 10;
```

The JSON matches each source's config shape: `object_storage` table objects are
`{"name","url","format"}` (`format` is `"parquet"`, `"csv"`, or `"json"`), and a
`warehouse` uses `credentials = '{"kind":"environment"}'` (or
`'{"kind":"static","access_key_id":"…","secret_access_key_env":"…"}'`). A
`credentials` blob may carry a secret, so prefer the `*_env` / secret forms and
keep such statements out of shared logs.

For a Postgres source, supply the DSN in exactly one of three ways —
`dsn` (literal), `dsn_env` (name of an env var holding it), or `dsn_secret`
(name of a stored [secret](#create-drop-secret)); they are mutually exclusive:

```sql
-- Literal DSN (quoting keeps the `=` and spaces intact):
CREATE CATALOG pg WITH (kind = 'postgres', dsn = 'host=db port=5432 dbname=app');

-- DSN from an environment variable read at connect time:
CREATE CATALOG pg WITH (kind = 'postgres', dsn_env = 'APP_PG_DSN');

-- DSN from an encrypted secret (see CREATE SECRET below):
CREATE CATALOG pg WITH (kind = 'postgres', dsn_secret = 'app_pg_dsn');
```

The source is **built and validated before anything is persisted**, so an
unreachable or misconfigured source fails the statement immediately — you never
end up with a half-registered catalog. `ALTER CATALOG` replaces the option set
wholesale and rebuilds. Once created, query it right away in the same session:

```sql
SELECT * FROM pg.public.users LIMIT 10;
DROP CATALOG IF EXISTS pg;
```

### `CREATE / DROP SECRET`

A secret is a named credential, **encrypted at rest** (XChaCha20-Poly1305; only
ciphertext ever reaches the store) and referenced by catalogs via `dsn_secret`
instead of inlining a DSN. Requires `DATAGLOT_SECRET_KEY`.

```text
CREATE [OR REPLACE] SECRET [IF NOT EXISTS] <name> AS '<value>'
DROP   SECRET [IF EXISTS] <name>
```

```sql
CREATE SECRET app_pg_dsn AS 'host=db port=5432 dbname=app user=svc password=hunter2';
CREATE CATALOG pg WITH (kind = 'postgres', dsn_secret = 'app_pg_dsn');
DROP SECRET IF EXISTS app_pg_dsn;
```

The store keeps only the *reference* (`dsn_secret = 'app_pg_dsn'`) in the catalog
config, never the DSN itself; the value is resolved and decrypted at
connect-build time. The secret value is redacted from logs and error messages.

### `CREATE / ALTER / DROP USER`, `CREATE / DROP ROLE`

Runtime login accounts and roles for [password authentication](#4-authentication).

```text
CREATE USER [IF NOT EXISTS] <name> [WITH] [PASSWORD '<pw>'] [SUPERUSER | NOSUPERUSER]
ALTER  USER <name> [WITH] PASSWORD '<pw>'
DROP   USER [IF EXISTS] <name>
CREATE ROLE [IF NOT EXISTS] <name>
DROP   ROLE [IF EXISTS] <name>
```

```sql
CREATE USER analyst WITH PASSWORD 'correct horse battery staple';
CREATE USER svc NOSUPERUSER;          -- passwordless: cannot log in with a password
ALTER  USER analyst PASSWORD 'a new one';
CREATE ROLE reporting;
DROP   USER IF EXISTS analyst;
```

`WITH` is an optional noise word. A `PASSWORD` clause is stored
encrypted-at-rest (same envelope key as secrets), so `CREATE USER … PASSWORD`
and `ALTER USER … PASSWORD` **require `DATAGLOT_SECRET_KEY`** — a passwordless
user or a role needs no key. A user created this way authenticates on the very
next connection (the store is read fresh on every login), with no config-file
entry.

**Usernames are globally unique across orgs.** A `CREATE USER` name must be free
in *every* org; creating a name already taken in another org is refused (even
with `IF NOT EXISTS`, since the name is unavailable rather than "already this
same user"). At login the store is scanned for the username and the one org that
owns it determines the connecting user's tenant — the session then runs scoped
to that org (its catalogs, secrets, and policy enforcement). Re-creating the
same name in the *same* org stays idempotent. `ALTER USER … PASSWORD`
changes a password within the user's org; it never moves a user between orgs.

### `CREATE / DROP MASK`, `CREATE / DROP ROW FILTER`

Plan-time governance: column masks and row filters baked into the physical plan.

```text
CREATE MASK [IF NOT EXISTS] <name> ON <table> ( <column> ) AS '<literal>'
CREATE MASK [IF NOT EXISTS] <name> ON <table> ( <column> ) WITH ( type = '<kind>' [, <k>=<v>]* )
CREATE ROW FILTER [IF NOT EXISTS] <name> ON <table> USING ( <predicate> )
DROP   MASK       [IF EXISTS] <name>
DROP   ROW FILTER [IF EXISTS] <name>
```

`<table>` may be bare, `schema.table`, or `catalog.schema.table` — it is stored
verbatim. A mask is either a constant literal replacement or a named mask type
(`redact`, `hash`, `show_last`, `show_first`, `nullify`, `date_year`,
`constant`), with type parameters (e.g. `keep`) carried as extra options. A row
filter's `USING ( … )` captures an arbitrary boolean SQL predicate.

```sql
-- Constant-literal mask:
CREATE MASK email_mask ON pg.public.users ( email ) AS '***@example.com';

-- Typed mask (show only the last 4 characters):
CREATE MASK ssn_mask ON pg.public.users ( ssn ) WITH ( type = 'show_last', keep = 4 );

-- Row filter (arbitrary boolean predicate; nested parens and quoted strings are fine):
CREATE ROW FILTER eu_only ON pg.public.orders USING ( region = 'EU' );

DROP MASK IF EXISTS ssn_mask;
DROP ROW FILTER IF EXISTS eu_only;
```

### `GRANT / REVOKE` (access control)

Privilege and role-membership grants for the deny-unless-granted authorization
model (see [access control](/docs/access-control/) for the concept, and
[authentication → Authorization](/docs/authentication/#authorization-what-you-may-read)
for how `authz.mode` is set). Persisted and org-scoped like every other
statement.

```text
GRANT  SELECT ON <catalog>.<schema>.<table> TO <grantee>
GRANT  USAGE  ON CATALOG <catalog>          TO <grantee>
GRANT  <role>                               TO <user>
REVOKE SELECT ON <catalog>.<schema>.<table> FROM <grantee>
REVOKE USAGE  ON CATALOG <catalog>          FROM <grantee>
REVOKE <role>                               FROM <user>
```

```sql
GRANT USAGE  ON CATALOG pg          TO analyst;   -- reference the catalog
GRANT SELECT ON pg.public.users     TO analyst;   -- read one table
GRANT reporting TO analyst;                        -- role membership
REVOKE SELECT ON pg.public.users    FROM analyst;
```

A privilege GRANT/REVOKE takes effect on every session's **next** query with no
reconnect (the grant set is republished to the live plan-time enforcer, the same
model as `CREATE / DROP MASK`). A **role-membership** change (`GRANT <role> TO
<user>`) is resolved into a session's identity at connect time, so it takes
effect for connections opened **after** it. The grantee need not pre-exist when
the grant is written (it is resolved by name at query time).

### `CREATE / DROP VIEW` (derived products)

A `CREATE VIEW` defines a Dataglot **derived product** — a named query over your
federated catalogs — fully from SQL, with no config-file
`[[derived_products]]` entry. Persisted and org-scoped like every other
statement.

```text
CREATE [OR REPLACE] VIEW [<catalog>.<schema>.]<name> AS <query>
DROP   VIEW [IF EXISTS] [<catalog>.<schema>.]<name>
```

```sql
-- A derived product federating two sources: enrich Postgres orders with the
-- MySQL customer name. The AS body is arbitrary SQL over any registered catalog.
CREATE VIEW order_customers AS
  SELECT o.id, o.total, c.name
  FROM   pg_orders.public.orders o
  JOIN   mysql_demo.demo.customers c ON c.id = o.customer_id;

SELECT * FROM order_customers WHERE total > 100;   -- query it like any table

CREATE OR REPLACE VIEW order_customers AS SELECT id, total FROM pg_orders.public.orders;
DROP VIEW IF EXISTS order_customers;
```

The `AS <query>` is **validated at `CREATE` time** — a query that can't plan
(unknown table/column, unreachable source) is rejected with a clear error and
nothing is persisted, exactly like `CREATE CATALOG` validates its source. An
unqualified name resolves under the server's default catalog/schema; a
`catalog.schema.name` resolves there.

A created view is queryable **immediately** in the creating session and by every
**subsequent** connection (it is registered into the live per-org view registry,
the same visibility model as `CREATE CATALOG`). It is a **derived product**, so
it appears in lineage, and it is **plain (non-materialized)**: the defining query
is planned on each read. Because
the view's plan is **inlined** at query time, a column mask on an underlying
source column stays masked **through** the view — you cannot read around a mask
by querying the view instead of the source.

> **Note.** `CREATE VIEW` here maps to a store-backed derived product, **not** a
> session-local ephemeral view. `DROP VIEW` targets these runtime-created
> products; a view declared in the config file's `[[derived_products]]` is managed
> through config.

## 4. Authentication

Dataglot authenticates connections in one of five modes, set in the bootstrap
config:

- **`trust`** (default) — no password check; the asserted username is trusted.
  Fine for local development and trusted networks.
- **`md5`** — Postgres MD5 password authentication.
- **`scram-sha-256`** — Postgres SCRAM-SHA-256 (SASL) authentication, a salted
  challenge–response that never puts a replayable password-equivalent on the
  wire. It verifies against the *same* credentials as md5, so switching is a
  one-line config change. Prefer it over md5 on any shared deployment.
- **`jwt`** — the client presents a signed JWT as its password; its verified
  `groups` claim drives directory-group policy (requires `[auth.jwt]`).
- **`ldap`** — the connection binds to the directory as the user; a group search
  drives directory-group policy (requires `[auth.ldap]`).

md5 and `scram-sha-256` are covered in full in
[authentication](/docs/authentication/). For the whole access-control
picture — authentication, GRANT authorization, and governance together — see
[access control](/docs/access-control/).

### Enabling md5

Turn on md5 mode in the bootstrap config, and seed **at least one** bootstrap
identity whose password comes from an environment variable (`password_env` holds
the *name* of the var, never the password itself):

```toml
host = "0.0.0.0"
port = 5432

[catalog_service]
path = "/var/lib/dataglot/meta.redb"

[auth]
mode = "md5"

[identities.admin]
password_env = "DATAGLOT_PW_ADMIN"
```

```bash
export DATAGLOT_PW_ADMIN='the-admin-password'
export DATAGLOT_SECRET_KEY="$(openssl rand -base64 32)"
dataglot --config bootstrap.toml
```

At least one identity must have a resolvable `password_env`, or the server
refuses to start in md5 mode (every connection would otherwise be rejected). The
bootstrap identity is your way in; from there you create the rest of your users
over SQL:

```sql
CREATE USER analyst WITH PASSWORD 'correct horse battery staple';
```

Runtime users (from `CREATE USER … PASSWORD`) and bootstrap `identities`
coexist: at login the meta store is consulted first, then the config
identities. Use whichever fits — config for a fixed fleet, SQL for
day-to-day user management with no config edits.

> **md5 without TLS.** MD5 password hashes and query results can cross the network in plaintext. For
> any shared deployment, also require ingress TLS: add a `[pgwire_tls]` block with
> `cert_file`, `key_file`, and `mode = "require"`. The server logs a warning at
> boot if md5 is on but TLS is not required.

## 5. Multi-tenancy (org)

Catalogs, secrets, users, roles, and governance rules are all **org-scoped** in
the meta store. A connection's org is resolved with this precedence:

1. the bootstrap `identities.<user>.org` field, if the user has a config profile;
2. otherwise, for a runtime `CREATE USER`, the org that owns the username —
   resolved at login because usernames are globally unique across orgs, so the
   login scan finds exactly one org;
3. otherwise the `"default"` org — identical to single-tenant behaviour.

The resolved org is mirrored into the session so every DDL statement that
connection runs is scoped to it.

```toml
[identities.alice]
org = "acme"
password_env = "DATAGLOT_PW_ALICE"
```

A `CREATE CATALOG` run by `alice` lands under org `acme` and is invisible to
`default`; the store keeps the two tenants' objects fully separate. Equivalently,
`CREATE USER bob …` issued on a connection scoped to `acme` creates `bob` under
`acme`, and `bob` then logs straight in to org `acme` — no config entry needed.

## 6. A full worked example

A complete session: boot in md5 mode, connect as the bootstrap admin, wire up an
encrypted source, create a runtime user, reconnect as them, and add a mask.

**1. Bootstrap config** (`bootstrap.toml`):

```toml
host = "127.0.0.1"
port = 5432

[catalog_service]
path = "/var/lib/dataglot/meta.redb"

[auth]
mode = "md5"

[identities.admin]
password_env = "DATAGLOT_PW_ADMIN"
```

**2. Boot** with the admin password and the envelope key:

```bash
export DATAGLOT_PW_ADMIN='admin-bootstrap-pw'
export DATAGLOT_SECRET_KEY="$(openssl rand -base64 32)"
dataglot --config bootstrap.toml
```

**3. Connect as admin** to the bootstrap database and set everything up:

```bash
psql -h 127.0.0.1 -p 5432 -U admin -d dataglot
```

```sql
-- Store the source DSN as an encrypted secret, then reference it from a catalog:
CREATE SECRET app_pg_dsn AS 'host=db port=5432 dbname=app user=svc password=hunter2';
CREATE CATALOG pg WITH (kind = 'postgres', dsn_secret = 'app_pg_dsn');

-- The catalog is live immediately:
SELECT email FROM pg.public.users LIMIT 3;
--        email
-- ---------------------
--  alice@example.com
--  bob@corp.example
--  carol@example.org

-- Create a runtime login (encrypted password; no config edit needed):
CREATE USER analyst WITH PASSWORD 'correct horse battery staple';
```

**4. Reconnect as the runtime user** and query through the catalog:

```bash
PGPASSWORD='correct horse battery staple' \
  psql -h 127.0.0.1 -p 5432 -U analyst -d pg
```

```sql
SELECT email FROM public.users LIMIT 3;   -- `pg` is the default catalog here
```

**5. Add a mask** and watch the same query come back masked:

```sql
CREATE MASK email_mask ON pg.public.users ( email ) AS '***@example.com';

SELECT email FROM public.users LIMIT 3;
--       email
-- -------------------
--  ***@example.com
--  ***@example.com
--  ***@example.com
```

The catalog, secret, user, and mask all survive a server restart — they live in
the meta store, not in a config file.

## 7. Migrating off a config file

If you have an existing sources config, each block maps to a
DDL statement (run once against the running server; the store then persists it):

| Old config block | DDL equivalent |
| --- | --- |
| `catalogs.<name>` (`kind`, `dsn`/`dsn_env`) | `CREATE CATALOG <name> WITH (kind='…', dsn_env='…')` |
| a DSN/password you kept out of the file via `*_env` | `CREATE SECRET <name> AS '…'` + `CREATE CATALOG … WITH (…, dsn_secret='<name>')` |
| `masks[]` (literal) | `CREATE MASK <name> ON <table> ( <col> ) AS '<literal>'` |
| `masks[]` (typed, e.g. `show_last`) | `CREATE MASK <name> ON <table> ( <col> ) WITH ( type='show_last', keep=4 )` |
| `row_filters[]` (SQL predicate) | `CREATE ROW FILTER <name> ON <table> USING ( <predicate> )` |
| `derived_products[]` (plain) | `CREATE VIEW <name> AS <query>` |
| `identities.<user>` login password | `CREATE USER <user> WITH PASSWORD '…'` (runtime), or keep a bootstrap `identities` entry with `password_env` to seed md5 |

**What stays in the bootstrap config** (it is needed before any connection can be
served, so it cannot be SQL): `host` / `port`, `pgwire_tls`, `auth.mode` plus at
least one bootstrap `identities` entry to seed md5, and `catalog_service` (the
meta-store location). Plus the `DATAGLOT_SECRET_KEY` environment variable.

**GitOps note:** dropping the config file does not remove version-controlled
desired-state — check in a SQL script (`CREATE CATALOG …` / `CREATE MASK …`)
applied at deploy. Same review/audit surface, in the SQL idiom.
