+++
title = "Catalogs, schemas & tables"
description = "The three-part name `catalog.schema.table`, what each part means in Dataglot, and how every kind of source is mapped into it."
weight = 50
+++

Every table in Dataglot has a three-part name:

```sql
SELECT * FROM pg.public.users;
--            ^  ^      ^
--            |  |      └── table
--            |  └───────── schema
--            └──────────── catalog
```

The vocabulary is PostgreSQL's, but one word means something different
here, and it is the word that causes all the confusion:

{% <callout type="warning" title="A catalog is a source, not a database"> %}
In PostgreSQL, a *catalog* is a database on the server you connected to.
In Dataglot, a **catalog is one data source you registered** — a Postgres
server, a Snowflake database, an Iceberg warehouse, a folder of Parquet
files, a REST API. The name is yours to choose; it is the handle you gave
that source, not a name the source knows about itself.
{% </callout> %}

So a three-part name reads: **which source**, **which namespace inside
it**, **which table**.

```sql
-- One query, three different systems:
SELECT u.email, o.total, s.segment
FROM   pg.public.users        u          -- a Postgres server
JOIN   sf.ANALYTICS.orders    o ON o.user_id = u.id   -- Snowflake
JOIN   files.public.segments  s ON s.user_id = u.id;  -- Parquet on S3
```

## Catalogs

A catalog is created once and then persists — either declared in
[`dataglot.toml`](/docs/configuration/) or created at runtime over SQL:

```sql
CREATE CATALOG pg WITH (kind = 'postgres', dsn_env = 'APP_PG_DSN');
```

The `kind` picks the connector; everything else is that connector's
options. You choose the catalog name (`pg` here), and it must be unique
across the server. Two catalogs may point at the same physical database
with different credentials — that is a normal way to expose one source
under two governance regimes.

`DROP CATALOG` removes the registration. It never touches the source.

## Schemas

The schema is the namespace *inside* the source. What fills it depends
entirely on what the source calls its own middle level — and that varies
more than you would hope:

| Catalog `kind` | The catalog is… | Schemas come from… |
|---|---|---|
| `postgres` | one Postgres **database** (the DSN's `dbname`) | that database's schemas, minus `pg_catalog`, `information_schema`, `pg_toast` |
| `mysql` | one MySQL **server** | MySQL **databases** — MySQL's "database" is this level — minus `information_schema`, `mysql`, `performance_schema`, `sys` |
| `snowflake` | one Snowflake **database** (`database = …`) | that database's schemas; an optional `schema = …` narrows it |
| `oracle` | one Oracle **service** | table **owners**; `schema = …` defaults to the connecting user |
| `warehouse` | one Iceberg **warehouse** | Iceberg **namespaces** |
| `object_storage` | a set of file **URLs you declare** | the `schema` field on each table — defaults to `public` |
| `odata` / `sap_s4hana` | one OData **service** | a single schema, named after the service's entity container |
| `rest` | a set of endpoints **you declare** | the catalog's `schema` field — defaults to `public` |

Two consequences worth internalising:

- **MySQL's "database" is Dataglot's schema.** `mysql.app.users` means
  the `users` table in the `app` database on the MySQL server you
  registered as `mysql`. There is no fourth level.
- **File and API sources have no natural middle level**, so they get
  `public` unless you say otherwise. `files.public.events` is the norm.

## Tables

Tables are whatever the source exposes: SQL tables and views, Iceberg
tables, one declared file or glob (`s3://lake/events/*.parquet`) per
table, one OData entity set per table, one REST endpoint per table.

### When the list is read

Discovery is a **snapshot taken when the catalog is built**, not a live
view of the source:

- For `postgres`, `mysql`, and `oracle`, the schema and table lists are
  read up front; each table's *column* types are fetched lazily on first
  use.
- `warehouse` is fully lazy — the connector resolves a namespace and
  table only when you name one.
- `object_storage` and `rest` tables are exactly what you declared.

If someone adds a table to the source afterwards, Dataglot will not see
it until the catalog is rebuilt. `ALTER CATALOG` (which replaces the
option set wholesale and rebuilds) or a `DROP` + `CREATE` picks it up; so
does a restart.

### Identifier casing

Three different conventions meet here, so quote when in doubt:

- **Postgres and MySQL** — unquoted identifiers fold to lower case, as
  usual.
- **Oracle** — unquoted identifiers fold to **upper** case; owners and
  table names generally arrive uppercase.
- **REST and OData** — field names are JSON, therefore case-sensitive.
  `SELECT "AnnualRevenue" FROM salesforce.public.account` needs the
  quotes.

## Unqualified names, and the `dbname` trick

The three-part name always works, from any session. Shorter names are
resolved against the session's defaults, which come from `default_catalog`
and `default_schema` (`dataglot` and `public` out of the box).

Because clients insist on sending a database name, Dataglot gives that
field a job: **the `dbname` you connect with selects the default
catalog.**

```bash
# Unqualified names resolve inside the `pg` catalog:
psql -h 127.0.0.1 -p 5432 -U admin -d pg

# Before any catalog exists, connect to the built-in bootstrap database:
psql -h 127.0.0.1 -p 5432 -U admin -d dataglot
```

It is a routing hint, not a credential, and it changes nothing about what
you may read — fully qualified names work regardless of which database
you connected to.

## The system catalogs

Alongside your catalogs, every session sees an emulated `pg_catalog` and
`information_schema`. That is what lets `\dt`, `\d table`, DBeaver,
DataGrip, Metabase, and Tableau introspect Dataglot as if it were
PostgreSQL. It is an emulation sized for tool introspection, not a
complete Postgres system catalog — the exact tables, functions, and known
client quirks are listed in the [pgwire API
reference](/docs/pgwire-api/).

## Views and derived products

`CREATE VIEW` defines a query as a named table in the meta store — a
**derived product**. Views are governed like any other table, and
governance follows the data: a mask on `pg.public.users.email` extends to
every derived column descending from it, so a view cannot be used to
launder a masked column into the clear. See [runtime
configuration](/docs/runtime-config/) for the DDL and [access
control](/docs/access-control/) for the propagation rules.

## Where next

- **[Add a data source](/docs/adding-a-source/)** — put this into
  practice against a real database.
- **[Data sources](/docs/data-sources/)** — the per-connector matrix.
- **[How Dataglot works](/docs/how-it-works/)** — what happens to a name
  after it resolves.
- **[Glossary](/docs/glossary/)** — the terms, in one place.
