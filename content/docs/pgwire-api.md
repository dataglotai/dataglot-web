+++
title = "PostgreSQL wire API"
description = "The client-facing command surface: connection semantics, supported statements, psql meta-commands, and single-node vs distributed parity."
weight = 100
+++

Dataglot speaks the **PostgreSQL v3 wire protocol**, so any PostgreSQL client — `psql`, `pgcli`, JDBC/ODBC, psycopg, `tokio-postgres`, and BI tools (DBeaver, DataGrip, Metabase, Tableau, Grafana) — connects with no custom driver. Under the hood a query flows `pg wire → planner → federation pushdown → source`; a full analytical SQL surface is available, plus a `pg_catalog` / `information_schema` emulation for tool introspection.

> **Scope.** This documents the client-facing command surface, not the SQL dialect.
> Verified live in **both** single-node and `--distributed` modes.

## Connecting

```text
psql "host=127.0.0.1 port=5432 user=<user> dbname=<catalog>"
```

- **`dbname` is a *catalog* name**, not a physical database — e.g. `tpch`, `pg`, `lakehouse`. It sets the session's default catalog (catalog-as-database). `dbname=dataglot` (or an unknown name) falls back to the server default. `current_database()` returns the resolved catalog.
- **Auth:** see [authentication](/docs/authentication/). Governance policies are enforced at plan time regardless of auth mode — run a password mode (or a trusted network) when policies are configured.
- **TLS:** the pg-wire listener supports `sslmode` require via server config (cert/key/CA); plaintext otherwise.

## Statement surface

| Category | Supported | Notes |
|---|---|---|
| **Queries** | ✅ `SELECT`, `WITH`/CTE, subqueries, joins, aggregates, `DISTINCT`, window functions, `ORDER/GROUP/LIMIT` | Full analytical surface — `CASE`, `coalesce`, `::` casts, `ARRAY[…]`, string/date/math functions, `array_upper/lower`, etc. |
| **Plans** | ✅ `EXPLAIN`, `EXPLAIN ANALYZE` | `EXPLAIN ANALYZE` reports distributed stage metrics (ShuffleWriterExec rows/timings) under `--distributed`. |
| **Prepared / extended protocol** | ✅ `PREPARE` / `EXECUTE(params)` / `DEALLOCATE` | The bind-parameter path JDBC/psycopg/BI drivers use. |
| **Session** | ✅ `SET` / `RESET` / `DISCARD ALL`, `SHOW <var>` | `SET` accepts session + custom vars; `SHOW server_version`, `search_path`, `transaction_isolation` resolve. |
| **Transactions** | ✅ `BEGIN` / `COMMIT` / `ROLLBACK` | Accepted with autocommit semantics — no MVCC / multi-statement transactional isolation. |
| **Introspection** | ✅ `pg_catalog.*`, `information_schema.*` | `pg_class`, `pg_namespace`, `pg_attribute`, `pg_type`, `pg_proc`, `pg_description`; `information_schema.tables/columns/schemata/views`. |
| **DDL (session)** | ⚠️ `CREATE TABLE` | Creates an in-memory session table. **Not readable back under `--distributed`** (a session MemTable isn't in the distributed codec registry) — single-node only. |
| **Writes to federated tables** | ❌ `INSERT` / `UPDATE` / `DELETE` on a federated source | Federation is the read path. Writable analytical tables go through Iceberg warehouses (a separate path), not federated `INSERT`. |
| **Bulk copy** | ⚠️ `COPY (query) TO STDOUT` (text) | Text egress works over the simple protocol — psql `\copy`, JDBC `CopyManager`. CSV/binary `WITH` options, `COPY … FROM STDIN`, and extended-protocol clients (e.g. `tokio_postgres::copy_out`) are follow-ups. |

### psql meta-commands

| Command | Status | Backed by |
|---|---|---|
| `\conninfo` | ✅ | client-side |
| `\l`, `\dn`, `\dt`, `\d`, `\d <table>`, `\dv`, `\di`, `\db` | ✅ | `pg_get_userbyid`, `format_type`, `pg_get_expr`, `pg_table_is_visible`, `current_schema` |
| `\df`, `\dT` | ✅ | `pg_function_is_visible` / `pg_type_is_visible` shims |
| `\du` | ✅ | `pg_roles` (empty — identity-aware roles are a follow-up) |
| `\copy … to` | ✅ | text format, via `COPY (query) TO STDOUT` |

The `\d` family and the functions behind it work in **both** single-node and
`--distributed` mode.

### Session / introspection functions

Implemented: `current_database()`, `current_schema()`, `current_schemas()`, `session_user`, `version()`, `format_type()`, `pg_get_userbyid()`, `pg_get_expr()`, `pg_table_is_visible()`, `pg_function_is_visible()`, `pg_type_is_visible()`, `has_*_privilege()`, `quote_ident()`, `pg_get_constraintdef()`, `pg_relation_size()`, `pg_encoding_to_char()`, `pg_backend_pid()`, and more.

`SHOW server_version_num` / `ssl` / `is_superuser` are shimmed, and `SHOW server_version` reports a PG-compatible `16.6 (Dataglot)` consistent with the startup value. Known thin spots: `pg_settings` is sparse (used for `SHOW ALL`); `pg_roles` is empty (identity-unaware); `oid` UDF args want `int4` (cast an integer literal: `pg_get_userbyid(CAST(n AS INT))`).

## Single-node vs `--distributed`

Dataglot runs the same pg-wire surface whether the server is single-node or a distributed cluster (`--distributed`). Almost everything behaves identically; the mode-specific behavior is called out here because "does it work distributed?" is the non-obvious axis.

| Command / feature | single-node | `--distributed` | Notes |
|---|---|---|---|
| `SELECT` / joins / aggregates / window / CTE | ✅ | ✅ | distributed splits the scan/compute across cluster slots |
| `EXPLAIN` / `EXPLAIN ANALYZE` | ✅ | ✅ | distributed run adds per-stage shuffle metrics |
| Prepared / extended protocol (`PREPARE`/`EXECUTE`) | ✅ | ✅ | |
| `SET` / `RESET` / `SHOW` / `DISCARD`; txn control | ✅ | ✅ | |
| `pg_catalog.*` / `information_schema.*` scans | ✅ | ✅ | |
| **psql `\d` family + introspection UDFs** (`pg_get_userbyid`, `format_type`, `pg_get_expr`, `current_schema`, …) | ✅ | ✅ | registered in distributed mode too |
| `\df` / `\dT` (`pg_function_is_visible` / `pg_type_is_visible`) | ✅ | ✅ | always-true shims registered in both modes |
| `SHOW server_version_num` / `ssl` / `is_superuser` | ✅ | ✅ | rewrite shims, mode-independent |
| `COPY (query) TO STDOUT` (text) | ✅ | ✅ | the inner query runs in the active mode; simple protocol only |
| **`CREATE TABLE` (session) then read it back** | ✅ | ❌ | a session `MemTable` isn't in the distributed codec registry — single-node only |
| `INSERT` / `UPDATE` / `DELETE` on a federated source | ❌ | ❌ | read path in both modes; writes go to Iceberg warehouses |
| Distributed sources w/o a codec (snowflake / oracle / adbc / rest) | ✅ (single-node) | ❌ (refused pre-submission) | run those catalogs single-node — a deliberate guardrail |

**Takeaway:** the introspection/driver surface is at parity across modes; the only functional single-node-only item is reading back a session-created table, plus the known "some federated sources have no distributed codec yet" guardrail.

## What tools need — and what Dataglot provides

For any pg-wire query engine, the bar for "psql and BI tools just work" is a
small set of `pg_catalog` tables and introspection functions that clients
query on connect. Dataglot implements that set — with real values, not
empty-string stubs — in both single-node and distributed modes, so the
`\d` family, driver metadata calls, and BI schema browsers behave the way
they do against a stock Postgres.

**Minimum `pg_catalog` set for `\dt` + `\d <table>`** (from psql's emitted SQL): populated `pg_class` + `pg_namespace` + `pg_attribute` + `pg_type` + `pg_attrdef`, and the functions `pg_get_userbyid`, `pg_table_is_visible`, `format_type`, `pg_get_expr`. `pg_function_is_visible` / `pg_type_is_visible` are needed only for `\df` / `\dT`. Dataglot provides all of these.

**BI-client tolerance (most → least forgiving):** Metabase / Tableau (lean on `information_schema`) → DBeaver (generic JDBC; hits specific gaps) → **DataGrip / PowerBI** (strictest — heavy `pg_catalog` startup queries; DataGrip's *"Introspect using JDBC metadata"* setting downshifts it toward `information_schema`).

## Roadmap of gaps

1. **Driver-friendliness:** flesh out `pg_settings` for `SHOW ALL`.
2. **`COPY` egress:** CSV/binary `WITH` options, `COPY … FROM STDIN` ingest, and the extended-protocol path (`tokio_postgres::copy_out`).
3. **Identity-aware `pg_roles` / visibility:** hook the policy identity into the catalog context so `\du` and `pg_*_is_visible` reflect the connected user (today: empty roles, uniformly-visible).

*Reference engines confirm the pragmatic pattern: implement the core functions (real or stubbed), keep `pg_catalog` a subset, and let tools lean on `information_schema` for the rest.*
