+++
title = "Data sources"
description = "Every connector Dataglot ships: what each one is called, whether it's in the prebuilt binary, how tables appear, what pushes down, and where it stops."
weight = 60
+++

A data source becomes queryable by registering it as a **catalog** with a
`kind` — the value that picks the connector. This page is the index of
every `kind`. The field-by-field options for each live in the
[configuration reference](/docs/configuration/); the how-to is [add a data
source](/docs/adding-a-source/).

## The connectors

| `kind` | Source | In the prebuilt binary? |
|---|---|---|
| `postgres` | PostgreSQL (and wire-compatible servers) | ✅ |
| `mysql` | MySQL / MariaDB | ✅ |
| `snowflake` | Snowflake | ✅ |
| `warehouse` | Iceberg warehouse via a REST catalog + S3 | ✅ |
| `object_storage` | Parquet / CSV / JSON files, local or on S3 | ✅ |
| `odata` | Any OData v2 service | ✅ |
| `sap_s4hana` | SAP S/4HANA (OData + SAP headers) | ✅ |
| `rest` | Generic JSON/REST APIs — Salesforce and similar | ✅ |
| `oracle` | Oracle Database | ⚠️ build from source |
| `adbc` | Any source with an ADBC driver you supply | ⚠️ build from source |

{% <callout type="info" title="The two build-from-source connectors"> %}
Their **configuration surface is always compiled in**, so a
`kind = "oracle"` or `kind = "adbc"` catalog on a stock binary is rejected
at boot with a clear error rather than a confusing parse failure. To use
them, build with the matching feature — see [building from
source](/docs/building-from-source/).
{% </callout> %}

## How each source is shaped

| `kind` | The catalog is | Tables come from | Credentials |
|---|---|---|---|
| `postgres` | one database (from the DSN) | discovered — every non-system schema | `dsn` / `dsn_env` / `dsn_secret` |
| `mysql` | one server | discovered — every non-system database | `dsn` / `dsn_env` / `dsn_secret` |
| `snowflake` | one database | discovered; `schema` narrows the scope | `user` + `password` / `password_env` |
| `oracle` | one service | discovered — by table owner | `user` + `password` / `password_env` |
| `warehouse` | one Iceberg warehouse | resolved lazily, by namespace | static keys or the AWS environment |
| `object_storage` | the URLs you declare | one per declared table or glob | `[s3]` block, or the AWS environment |
| `odata` / `sap_s4hana` | one OData service | one per entity set | basic or bearer |
| `rest` | the endpoints you declare | one per declared table | none, basic, bearer, header, or OAuth 2.0 |
| `adbc` | whatever the driver exposes | discovered via the driver | driver options + `password_env` |

Details of the namespace mapping — what lands in the *schema* slot for
each of these — are in [catalogs, schemas &
tables](/docs/catalogs-and-schemas/).

## What pushes down

Pushdown is the whole performance story: the more of your query executes
inside the source, the less data crosses the wire.

**SQL sources — `postgres`, `mysql`, `snowflake`, `oracle`, `adbc`** —
receive real SQL in their own dialect. Federation hands the connector the
largest slice of the plan belonging to that one source, so filters,
projections, limits, aggregations, and same-source joins all execute
remotely.

**Non-SQL sources** have no remote SQL engine, so their connectors
translate what they can into the source's own request shape:

| `kind` | Pushed to the source | Runs in Dataglot |
|---|---|---|
| `warehouse` | column projection, predicate filtering, partition/file pruning | joins, aggregation |
| `object_storage` | column projection, predicate filtering, file pruning (Parquet row groups) | joins, aggregation |
| `odata` / `sap_s4hana` | `$select`, `$filter`, `$top` | anything the OData query surface can't express |
| `rest` | the endpoint's own query string plus pagination | filtering and aggregation, unless the URL encodes it |

Whatever cannot be pushed runs locally over Arrow batches — and
cross-source joins always run locally, by definition. `EXPLAIN FEDERATION`
prints exactly what was sent to each source, so none of this has to be
inferred:

```sql
EXPLAIN FEDERATION SELECT * FROM pg.public.orders WHERE amount > 100;
```

## Transport security

| `kind` | Encryption in transit |
|---|---|
| `postgres` / `mysql` | `tls = "require"` verifies the source certificate; `tls_ca_file` supplies a private CA |
| `snowflake` | HTTPS, inherent to the API |
| `odata` / `sap_s4hana` / `rest` | HTTPS whenever the URL is `https://` |
| `warehouse` / `object_storage` | HTTPS to the catalog and to S3, per endpoint |
| `oracle` / `adbc` | per the driver's own configuration |

Credentials themselves follow one rule everywhere: **secrets never live in
the config file**. Every credential field has an `*_env` twin naming an
environment variable, and catalogs created over SQL can reference an
encrypted [`CREATE SECRET`](/docs/runtime-config/) by name.

## Known limits

- **Federated sources are read-only.** No `INSERT` / `UPDATE` / `DELETE`
  against a federated source; writable analytical tables go through
  Iceberg warehouses instead.
- **`object_storage` supports `file://` and `s3://` only.** `gs://` and
  `abfs://` are not supported yet. S3-compatible stores (MinIO, R2, Ceph)
  work through the `endpoint` option.
- **Not every source distributes.** `postgres`, `mysql`, `snowflake`,
  `warehouse`, and `object_storage` work under distributed execution.
  The direct-`TableProvider` sources — `odata`, `sap_s4hana`, `rest` —
  always run single-node, and `oracle` / `adbc` distribute only when the
  server *and* the executors were built with their feature. Querying an
  unsupported source in distributed mode is refused with a message
  telling you to run it single-node.
- **Table lists are a snapshot.** They are read when the catalog is built;
  a table added to the source afterwards appears only after
  `ALTER CATALOG`, a drop and re-create, or a restart.
- **`oracle` has two drivers.** `driver = "oci"` needs the Oracle Instant
  Client at runtime; `driver = "pure"` is pure Rust and needs nothing
  native. Selecting a driver that wasn't compiled in fails at boot.
- **`rest` schemas are declared, not discovered.** There is no metadata
  document to read, so each table names its own columns and types.

## Where next

- **[Add a data source](/docs/adding-a-source/)** — the step-by-step.
- **[Configuration file](/docs/configuration/)** — every option of every
  `kind`.
- **[Catalogs, schemas & tables](/docs/catalogs-and-schemas/)** — how a
  source's namespace maps to a Dataglot name.
- **[Building from source](/docs/building-from-source/)** — for `oracle`
  and `adbc`.
