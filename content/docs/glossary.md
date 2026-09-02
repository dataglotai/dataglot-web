+++
title = "Glossary"
description = "Every term Dataglot's docs rely on, defined once — from catalog and pushdown to plan-time governance and the meta store."
weight = 80
+++

Terms as Dataglot uses them. Where a word means something different in
PostgreSQL or in a warehouse, the difference is called out.

### Arrow

The columnar in-memory format all query execution runs on. Results come
back from connectors as Arrow record batches and are converted to
PostgreSQL rows at the wire.

### Batch

A chunk of rows moved through execution together — `batch_size` rows by
default. A tuning knob, not something you query.

### Bootstrap config

The small TOML file the server needs *before* it can accept a connection:
bind address, TLS, auth mode, and where the meta store lives. Everything
else can be created later over SQL. See [runtime
configuration](/docs/runtime-config/).

### Catalog

**One registered data source**, named by you — a Postgres server, a
Snowflake database, an Iceberg warehouse, a set of files, an API. It is
the first part of `catalog.schema.table`.

Not the PostgreSQL meaning: in Postgres a catalog is a database on the
server you connected to. See [catalogs, schemas &
tables](/docs/catalogs-and-schemas/).

### Codec

The serialization that carries a query plan — including the catalog
configuration an executor needs to rebuild its connectors — to worker
processes in distributed mode.

### Connector

The code that talks to one kind of source. A connector either speaks SQL
to the source (unparsing plans into its dialect) or is a direct table
provider that translates scans into the source's own request shape. See
[data sources](/docs/data-sources/).

### Coordinator

In distributed mode, the `dataglot` server process: it plans queries and
is the only process that opens the meta store. Executors never touch it.

### Data product

A named, governed dataset published to an external metadata platform such
as DataHub, so a governance catalog can see what Dataglot exposes.
Configured under `governance_publishers`.

### Derived product

A view: a query stored under a name and queried like a table. Governance
follows the data through it — a mask on a source column extends to every
derived column descending from it. Also called a **view**.

### Dialect

The SQL flavour a source expects. Federation unparses a plan into the
target's dialect, which is why MySQL gets backticks and Postgres does not.

### EXPLAIN FEDERATION

The statement that prints exactly which SQL — or which request — was
shipped to each source for a given query. The tool for answering "did that
actually push down?"

### Executor

In distributed mode, a worker process that runs plan fragments. It
rebuilds its own connectors from the plan it receives and never reads the
meta store.

### Fail-closed

The property that any error — missing credential, missing grant, decrypt
failure — results in denial rather than access. You opt out of enforcement
with permissive defaults; you never opt into a leak.

### Federation

Executing one query across more than one source: splitting the plan so
each source runs the largest slice that belongs to it, then combining the
results locally.

### Grant

An authorization rule: which catalogs and tables an identity may read.
Under `authz.mode = grant`, everything is denied until granted.

### Identity

Who a session is, for policy purposes — the username the connection
asserted or authenticated as. Masks, filters, and grants are evaluated
against it.

### Logical plan

The tree a SQL statement becomes after parsing, before execution. It is
where governance is applied and where federation splits work — the reason
policy cannot be bypassed.

### Mask

A column-level rule replacing a value in query output: redact, hash, show
first or last *N* characters, nullify, or substitute a constant. Compiled
into the plan's projection, not applied afterwards.

### Meta store

The durable home of the control plane — catalogs, secrets, users, roles,
grants, masks, row filters, derived products. Embedded `redb` by default,
PostgreSQL for HA. It never holds your data. See [meta
store](/docs/meta-store/).

### Object storage

Files queried in place — Parquet, CSV, or newline-delimited JSON on local
disk or S3 — registered as tables by URL.

### OData / entity set

A REST protocol for tabular data. Each **entity set** in an OData service
becomes one table; the service's entity container becomes the schema.

### Org

The multi-tenancy boundary in the meta store. Catalogs, users, and
policies are keyed by org, so one control plane can serve several tenants.

### pgwire

The PostgreSQL v3 wire protocol — the protocol Dataglot speaks, which is
why any PostgreSQL client connects without a custom driver.

### Plan-time governance

Dataglot's central idea: masks and row filters are typed expressions
rewritten into the logical plan before execution, rather than UDFs, view
definitions, or rewritten SQL text. Since every query is planned, there is
no path around them. See [how Dataglot works](/docs/how-it-works/).

### Pushdown

Making the source do the work — sending it filters, projections, limits,
aggregations, or joins instead of pulling rows back to process locally.
The main determinant of query performance.

### Role

A named bundle of grants that identities can be members of.

### Row filter

A row-level rule: a predicate attached to a table so a session only ever
sees matching rows. Enforced as a mandatory `Filter` above the table scan.

### Schema

The middle part of `catalog.schema.table` — the namespace inside a source.
What fills it depends on the source: a Postgres schema, a MySQL database,
an Iceberg namespace, an OData entity container, or `public` for sources
with no natural middle level.

### Secret

A named credential encrypted at rest in the meta store and referenced by
name (`dsn_secret = '…'`) instead of inlined. Requires
`DATAGLOT_SECRET_KEY`.

### Spill

Writing intermediate data to disk when a join, sort, or aggregation
exceeds `memory_limit_bytes`, instead of growing until the process is
killed.

### Tag

A typed label on a catalog, table, or column that governance rules match
on — so a policy can say "mask everything tagged PII" rather than naming
columns one at a time.

### Warehouse

A catalog kind: Iceberg tables reached through a REST catalog with S3
storage. Also the one path where analytical tables are writable.
