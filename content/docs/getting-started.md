+++
title = "Quickstart"
description = "Install Dataglot, point it at a database you already run, and get a governed, federated SQL endpoint in about five minutes."
weight = 10
+++

Five minutes, no compiling, no cluster: install a prebuilt Dataglot,
start it, and administer everything — sources, credentials, policies —
over `psql` with plain SQL. All you need is a database you already run
(Postgres in the examples below) and any PostgreSQL client.

## 1. Install and start

Pick whichever channel you prefer (all of them ship the same prebuilt
`dataglot` binary — see [Install](/docs/install/) for tarballs and
`cargo binstall` too):

{% <code_tabs labels="Homebrew, Docker"> %}
```bash
brew install dataglotai/tap/dataglot && dataglot
```

```bash
docker run --rm -p 5432:5432 ghcr.io/dataglotai/dataglot:latest
```
{% </code_tabs> %}

Started fresh, the server boots with **no catalogs** and prints a banner
saying so. That's expected — you create everything at runtime with SQL.

## 2. Connect

Dataglot speaks the PostgreSQL wire protocol, so connect with `psql` (or
DBeaver, Metabase, any Postgres driver). Before any catalog exists, use
the built-in bootstrap database `dataglot`:

```bash
psql -h 127.0.0.1 -p 5432 -U admin -d dataglot
```

(Out of the box the username is a policy *identity*, not a credential —
the default auth mode is `trust`, meant for local use. See
[Authentication](/docs/authentication/) before exposing a port.)

## 3. Add your first source — with SQL

No config file: a catalog is a federated data source, created against
the running server and persisted across restarts.

```sql
CREATE CATALOG pg WITH (
  kind = 'postgres',
  dsn  = 'host=localhost port=5433 user=me password=secret dbname=app'
);
```

The source is validated before anything is persisted — an unreachable
DSN fails the statement instead of leaving a half-registered catalog.
Query it immediately, in the same session:

```sql
SELECT * FROM pg.public.users LIMIT 10;
```

Prefer not to inline credentials? Store them encrypted and reference by
name (requires a `DATAGLOT_SECRET_KEY` env var on the server):

```sql
CREATE SECRET app_pg_dsn AS 'host=localhost port=5433 user=me password=secret dbname=app';
CREATE CATALOG pg WITH (kind = 'postgres', dsn_secret = 'app_pg_dsn');
```

Add a second source the same way — MySQL, Oracle, Snowflake, Iceberg,
or even a bare CSV/Parquet file — and JOIN across them in one statement:

```sql
CREATE CATALOG files WITH (
  kind = 'object_storage',
  tables = '[{"name":"segments","url":"file:///data/segments.csv","format":"csv"}]'
);

SELECT u.email, s.segment
FROM   pg.public.users u
JOIN   files.public.segments s ON u.id = s.user_id;
```

## 4. Govern it — also with SQL

Masks and row filters are compiled into the query plan itself: a masked
column is never fetched from storage, and there is no code path around
the filter.

```sql
CREATE MASK email_mask ON pg.public.users (email) AS '***@example.com';
CREATE ROW FILTER active_only ON pg.public.users USING (active = true);
```

Every session now sees the governed view:

```sql
SELECT id, email FROM pg.public.users ORDER BY id;
```

```text
 id |      email
----+-----------------
  2 | ***@example.com
(1 row)
```

Masks can also redact, hash, show first/last N characters, or nullify —
see [Access control & policies](/docs/access-control/).

## 5. See what runs where

`EXPLAIN FEDERATION` shows the exact SQL Dataglot ships to each source —
whole aggregations, not just scans — so you always know what left the
building:

```sql
EXPLAIN FEDERATION
SELECT user_id, SUM(amount) AS total
FROM pg.public.orders
GROUP BY user_id ORDER BY total DESC;
```

## 6. Query without a server

The same binary is a CLI and a REPL: `dataglot query` runs one statement
with the full engine — federation, masks, row filters — **in-process**,
no server, no port, no `psql`. Perfect for scripts, CI checks, and quick
looks at a source:

```bash
dataglot query -c dataglot.toml "SELECT count(*) FROM pg.public.orders"
echo "SELECT 1" | dataglot query -c dataglot.toml --format json -
dataglot shell -c dataglot.toml     # interactive; \q to quit
```

The [CLI & REPL reference](/docs/cli/) covers output formats (table, CSV,
NDJSON), stdin piping, exit codes, and shell completions.

## Where next

- **Runtime configuration** — the full SQL DDL surface (catalogs,
  secrets, users, roles, masks): [Runtime configuration](/docs/runtime-config/).
- **Config-file deployments** — prefer declarative files? Every runtime
  object can also live in `dataglot.toml`:
  [Configuration file](/docs/configuration/).
- **Lock down access** — password/SSO logins, TLS, per-user policies:
  [Authentication](/docs/authentication/) and
  [Access control](/docs/access-control/).
- **Check your tools** — [Client compatibility](/docs/compatibility/)
  covers psql, DBeaver, Metabase, DataGrip, dbt, and the major drivers.
