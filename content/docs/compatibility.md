+++
title = "Client compatibility"
description = "The verified client-tool matrix — psql, DBeaver, DataGrip, Metabase, dbt, JDBC, psycopg, node-postgres — and the limitations that are by design."
weight = 90
+++

Dataglot speaks the PostgreSQL wire protocol (both simple and extended
flavors), so anything built on a Postgres driver connects. GUI tools
are grouped under the driver they embed — a tool's schema browser and
query runner exercise exactly the driver behaviors the matrix scripts.

> **Scripted verification.** The matrix below is verified by an automated
> smoke suite that runs **connect / introspect / federated query / extended
> protocol (parameterized) / cancel** through each driver stack against a
> live server on every release.

All stacks pass (psql, node-postgres, pgJDBC, psycopg) in both single-node
and `--distributed` modes. One operational note for distributed servers:
under heavy concurrent load, queries queue for executor slots and resume
as slots free — throughput behavior, independent of the client.

## Matrix

| Tool / stack | Driver | Connect | Introspect | Federated query | Extended protocol | Cancel | Verified |
|---|---|---|---|---|---|---|---|
| **psql** | libpq | ✅ | ✅ (`\dt`, `\d`, information_schema) | ✅ | ✅ (`\bind`) | ✅ Ctrl-C | scripted |
| **pgcli** | psycopg | ✅ | ✅ | ✅ | ✅ | ✅ | via psycopg (scripted); single-node + `--distributed` |
| **Python** (psycopg 3) | psycopg | ✅ | ✅ | ✅ | ✅ | ✅ `Connection.cancel()` | scripted; `--distributed` verified 30/30 |
| **dbt-postgres** | psycopg2 | ✅ | ✅ | ✅ | ✅ | ✅ | via psycopg (scripted); no DDL → see limits |
| **Node.js** (`pg`) | node-postgres | ✅ | ✅ | ✅ | ✅ | n/a (driver exposes no cancel API) | scripted |
| **DBeaver** | pgJDBC | ✅ | ✅ (`DatabaseMetaData`) | ✅ | ✅ | ✅ `Statement.cancel()` | via pgJDBC (scripted) |
| **DataGrip** | pgJDBC | ✅ | ✅ | ✅ | ✅ | ✅ | via pgJDBC (scripted) |
| **Metabase** | pgJDBC | ✅ | ✅ | ✅ | ✅ | ✅ | via pgJDBC (scripted) |
| **Grafana** (postgres datasource) | lib/pq (Go) | ✅ | ✅ | ✅ | ✅ | — | expected (wire-identical checks pass on 4 other stacks) |
| **Rust** (tokio-postgres) | tokio-postgres | ✅ | ✅ | ✅ | ✅ | ✅ | CI e2e |

Query cancellation (the wire `CancelRequest`) is handled server-side
for both the planning and streaming phases, including distributed
queries — a cancelled distributed job is also cancelled on
the cluster, not orphaned.

## Catalogs are databases to your client

`\dt other_catalog.schema.*` errors with "cross-database references are
not implemented" — identical to real Postgres, because each Dataglot
catalog is a *database* in psql's model. Reconnect with
`dbname=<catalog>`, or use `information_schema` with a `table_catalog`
predicate.

## Known limitations (by design)

Dataglot is a **read-path federation and governance engine**, not a
Postgres replacement. Tools that assume full Postgres will hit these:

- **No data-plane DML** — `INSERT` / `UPDATE` / `DELETE` and model
  materialization (`CREATE TABLE AS`) are not supported; Dataglot is a
  read/federation + governance engine. dbt works for `SELECT`-shaped workflows
  (sources, tests, compiled queries) but cannot materialize models.
  *Control-plane* DDL — `CREATE CATALOG` / `SECRET` / `USER` / `ROLE` / `MASK` /
  `ROW FILTER` / `VIEW` / `GRANT` — **is** supported at runtime (see
  [runtime configuration](/docs/runtime-config/)); a session `CREATE TABLE`
  also works single-node.
- **No COPY protocol ingest** — bulk load belongs to the sources, not the
  federation layer. Tools that hard-require `COPY` for export will
  fall back to row-by-row fetch or fail on that feature only.
- **No transactions** — `BEGIN`/`COMMIT` are accepted as no-ops (pooler
  compatibility), which is correct
  for a read-only engine but means tools cannot rely on isolation
  semantics.
- **Session-control no-ops** — `DISCARD`, `RESET`, `SAVEPOINT` return
  success without effect (pooler compatibility).

## Wire behaviors tools rely on (implemented)

- `information_schema.tables` / `columns` and the `pg_catalog` subset
  that psql's `\d*` commands and JDBC's `DatabaseMetaData` issue
  (catalog-metadata queries are routed through a dedicated bypass to
  keep them fast against federated sessions).
- `version()`, `current_database()`, `current_schema()` and the
  startup parameters GUIs read.
- Extended-protocol prepare/bind/execute with typed parameters.
- `BackendKeyData` + `CancelRequest` — wire-level cancel from a second
  connection, the mechanism every tool's "stop query" button uses.
