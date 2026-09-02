+++
title = "Add a data source"
description = "Register a database, warehouse, file store, or API as a catalog — over SQL or in the config file — then verify it actually works."
weight = 70
+++

Adding a source means creating a **catalog**: a named registration that
tells Dataglot how to reach the source and what to call it. Nothing is
copied, mirrored, or migrated — the source keeps its data and you get a
name you can query.

There are three ways to register one. They produce the same thing.

| Route | Use it when |
|---|---|
| **SQL DDL** — `CREATE CATALOG` | The normal path. Works against a running server, takes effect immediately, survives restarts. |
| **Config file** — `[catalogs.<name>]` in `dataglot.toml` | You want sources declared declaratively and version-controlled. |
| **Environment** — `DATAGLOT_CATALOG_<NAME>` | Containerized / 12-factor deploys with no file to mount. |

## 1. Decide how the credential gets in

Do this first, because it changes the shape of the statement you write.
The rule everywhere in Dataglot: **a secret never belongs in a config
file**.

| Form | What it is | Good for |
|---|---|---|
| `dsn = '…'` | the literal connection string | local development |
| `dsn_env = 'APP_PG_DSN'` | the *name* of an environment variable | containers, CI, most deployments |
| `dsn_secret = 'app_pg_dsn'` | the *name* of a stored, encrypted secret | shared servers, anything long-lived |

Non-DSN connectors follow the same pattern with `password_env`,
`token_env`, `secret_access_key_env`, and so on.

To use the third form, create the secret first. It is encrypted before it
reaches the meta store, so the server needs an envelope key in
`DATAGLOT_SECRET_KEY`:

```bash
export DATAGLOT_SECRET_KEY="$(openssl rand -base64 32)"
dataglot --config bootstrap.toml
```

```sql
CREATE SECRET app_pg_dsn AS 'host=db port=5432 user=svc password=hunter2 dbname=app';
```

Only the *reference* is stored on the catalog; the value is decrypted at
connect time and is redacted from logs and errors.

## 2. Create the catalog

{% <code_tabs labels="Over SQL, In dataglot.toml"> %}
```sql
CREATE CATALOG pg WITH (
  kind      = 'postgres',
  dsn_secret = 'app_pg_dsn'
);
```

```toml
[catalogs.pg]
kind = "postgres"
dsn_env = "APP_PG_DSN"
tls = "require"
```
{% </code_tabs> %}

The name you pick (`pg`) becomes the first part of every table name in
that source: `pg.public.users`.

{% <callout type="success" title="It fails fast, not halfway"> %}
The source is **built and validated before anything is persisted**. An
unreachable host or a bad credential fails the `CREATE CATALOG` statement
itself — you never end up with a half-registered catalog that breaks
queries later.
{% </callout> %}

### Sources that need nested config

`object_storage`, `rest`, and `warehouse` need structures rather than flat
strings — a list of tables, a credentials object. Over SQL, pass those as
a **quoted JSON string**; any option value starting with `[` or `{` is
parsed as JSON:

```sql
CREATE CATALOG files WITH (
  kind   = 'object_storage',
  tables = '[{"name":"events","url":"s3://lake/events/*.parquet","format":"parquet"}]'
);
```

In a config file the same thing is ordinary TOML:

```toml
[catalogs.files]
kind = "object_storage"

[[catalogs.files.tables]]
name = "events"
url = "s3://lake/events/*.parquet"
format = "parquet"
```

Every option of every `kind` is in the [configuration
reference](/docs/configuration/); which `kind` you want is in [data
sources](/docs/data-sources/).

## 3. Verify it

Query it immediately — in the same session, no restart:

```sql
\dn                                  -- schemas Dataglot found in the source
\dt pg.public.*                      -- tables in one of them
SELECT * FROM pg.public.users LIMIT 10;
```

Then confirm the work is actually happening *in the source* rather than
being dragged across the wire:

```sql
EXPLAIN FEDERATION
SELECT user_id, SUM(amount) FROM pg.public.orders GROUP BY user_id;
```

You should see the aggregation in the SQL shipped to `pg`. If you instead
see a bare scan, the query is pulling rows back to be aggregated locally —
usually a sign the plan couldn't be expressed in the source's dialect.

Finally, join it to something you already had. This is the point of the
exercise:

```sql
SELECT u.email, s.segment
FROM   pg.public.users u
JOIN   files.public.segments s ON s.user_id = u.id;
```

## 4. Govern it before anyone else connects

A new catalog is new exposure. Masks and row filters are enforced [in the
query plan](/docs/how-it-works/), so applying them is a two-line job and
there is no way around them afterwards:

```sql
CREATE MASK email_mask ON pg.public.users (email) AS '***@example.com';
CREATE ROW FILTER active_only ON pg.public.users USING (active = true);
```

If the server runs with `authz.mode = grant`, the catalog is
deny-unless-granted until you say otherwise:

```sql
GRANT USAGE  ON CATALOG pg      TO analyst;   -- reference the catalog
GRANT SELECT ON pg.public.users TO analyst;   -- read one table
```

See [access control & policies](/docs/access-control/) for the full model.

## 5. Change or remove it

```sql
ALTER CATALOG pg WITH (kind = 'postgres', dsn_secret = 'app_pg_dsn_v2');
DROP  CATALOG IF EXISTS pg;
```

`ALTER CATALOG` replaces the **whole** option set and rebuilds the
connector — always repeat `kind` and every option you still want. Because
it rebuilds, it is also how you pick up tables added to the source since
the catalog was created. `DROP CATALOG` removes the registration only; the
source is untouched.

## When it doesn't work

| Symptom | Cause | Fix |
|---|---|---|
| `CREATE CATALOG` fails immediately | the source was validated and unreachable | check the DSN, network, and credentials — the error names what failed |
| Boot fails on a catalog that used to work | a source is down and `tolerate_unreachable_catalogs` is `false` | fix the source, or set it to `true` to boot with a warning and skip it |
| `kind = "oracle"` / `"adbc"` rejected at boot | the connector isn't compiled into this binary | [build from source](/docs/building-from-source/) with the matching feature |
| `CREATE SECRET` refused | `DATAGLOT_SECRET_KEY` is unset | export a base64 32-byte key and restart; keep it stable across restarts |
| An option is rejected as malformed | a nested value must be JSON over SQL | quote it, starting with `[` or `{` |
| A table you can see in the source is missing | the table list is a snapshot from catalog build time | `ALTER CATALOG`, or drop and re-create |

## Where next

- **[Catalogs, schemas & tables](/docs/catalogs-and-schemas/)** — why the
  schema part is what it is.
- **[Runtime configuration](/docs/runtime-config/)** — the rest of the SQL
  DDL surface.
- **[Access control & policies](/docs/access-control/)** — govern the new
  source properly.
