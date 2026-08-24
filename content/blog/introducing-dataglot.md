+++
title = "Introducing Dataglot"
description = "A Rust-native federated SQL engine that enforces governance inside the query plan — open source, PostgreSQL-compatible, and running today."
date = 2026-08-23
[taxonomies]
category = ["announcements"]
[extra]
author = "Mustafa Sakalsiz"
+++

Today we're launching [Dataglot](https://github.com/dataglotai/dataglot): a Rust-native federated SQL query engine with governance enforcement compiled into the query plan. It speaks the PostgreSQL wire protocol, so `psql`, DBeaver, Metabase, Tableau, dbt, and every Postgres driver you already use connect with no special client. You point it at the databases you already run — PostgreSQL, MySQL, Oracle, Snowflake, S3/Parquet, Apache Iceberg — and query across all of them in one SQL statement, with column masks and row filters that are structurally guaranteed, not bolted on.

It's Apache-2.0 licensed, and you can run your first governed, cross-source query in about five minutes with nothing but Docker.

## Why we built it

Dataglot exists because regulated enterprises — banks, insurers, healthcare systems — have two problems that current tooling doesn't solve together.

**Governance definitions don't translate to enforcement.** Nearly every regulated organization runs a governance platform: DataHub, Informatica, Collibra, Alation. The vendor varies, but the shape is constant — a catalog of datasets, columns, classifications, and policies. That catalog is the *definition* of how data should be treated. The gap is enforcement. A steward classifies a column as PII, and nothing in the query engine structurally guarantees that column is never returned in plaintext to the wrong user. Enforcement today is post-parse SQL rewrites injected in front of the engine (fragile), UDFs deployed to every worker (invisible to consumers), access-request ticketing (human-in-the-loop, not structural), or "we trust the BI tool" (not enforcement at all). Auditors know this. Regulators know this.

**The economics of proprietary analytical appliances are punishing.** The workloads those policies apply to often run on hardware appliances locked into multi-year refresh cycles, where a single box can represent an eight-figure commitment over the contract term. Organizations want an exit path that doesn't require rewriting every query, re-platforming every dashboard, and abandoning the governance investment they already made.

One engine can address both: federate the existing data estate through a single PostgreSQL-compatible endpoint, and make the governance platform's definitions a query-time guarantee inside that engine. Your governance platform defines what PII means in your organization; Dataglot is where that definition becomes enforceable.

## What "governance in the plan" means

Most policy enforcement rewrites SQL text after parsing, or filters rows after execution. Dataglot compiles policy into the physical query plan itself. Masks and row filters become typed expression predicates pushed into the scan — which means a masked column is **never fetched from storage**, on any code path, for any client. There is no execution path that returns ungoverned data, because the engine never retrieved it.

The guarantee is also *visible*. `EXPLAIN` shows the policy-enforcement pass in the plan, and `EXPLAIN FEDERATION` shows exactly what SQL was shipped to each source — whole aggregations, not just scans.

## What works today

Dataglot is pre-1.0 and moving fast, but the current release (v0.5.0) is already a substantial engine. As of today it ships:

- **Federation** across PostgreSQL, MySQL, Oracle, Snowflake, object storage (S3/Parquet), and Apache Iceberg, plus a generic ADBC bring-your-own-driver connector — with cost-aware pushdown and `EXPLAIN FEDERATION` to prove it.
- **Plan-time governance**: named mask types (redact, hash, show-first/last-N, nullify, and more), row filters, table- and column-level access deny, role resolution, and lineage-propagated masking — a mask on a source column automatically covers every derived column that descends from it. Masks apply inside subqueries too; we test the bypass paths.
- **A SQL-native control plane.** A running server is administered entirely over the pg wire: `CREATE CATALOG`, `CREATE SECRET` (encrypted at rest), `CREATE USER`/`ROLE`, `GRANT`/`REVOKE`, `CREATE MASK`, `CREATE ROW FILTER`, `CREATE VIEW`. No config edit, no restart.
- **Enterprise authentication**: SCRAM-SHA-256 and md5, LDAP/Active Directory group resolution, pg-wire ingress TLS, TLS to source databases, and connection admission control with per-identity rate ceilings.
- **Governance integrations**: column-level OpenLineage events on every query, DataHub data-product registration, policy explainability (`POST /policy/explain` tells you why a row was excluded or a column masked), and an inbound webhook so tag changes in your governance platform propagate to enforcement in under a minute.
- **Distributed execution** on Apache Ballista with object-store-based scheduler HA (no ZooKeeper, no etcd), cluster mTLS, and near-linear scaling measured on TPC-H across four workers.
- **Operations**: a live dashboard (source health, query history, sessions, governance posture), a structured audit trail queryable via SQL, and a multi-engine browser testbench that diffs Dataglot's results row-by-row against other engines.

And a hard constraint we've held from day one: **no JVM in the production runtime**. Dataglot is a single Rust binary, built on the proven Apache DataFusion and Arrow foundation.

## Honest scope

Dataglot is a read-path federation and governance engine. It is not a general-purpose PostgreSQL replacement, and it's not trying to be a SaaS data-integration tool — [we wrote about that boundary separately](/blog/what-we-build-and-what-we-wont/). The [client compatibility matrix](/docs/compatibility/) documents exactly which tools work and where the edges are.

## Try it in five minutes

No build step, no toolchain — grab a prebuilt Dataglot and go:

{% <code_tabs labels="Docker, Homebrew"> %}
```bash
docker pull ghcr.io/dataglotai/dataglot
```

```bash
brew install dataglotai/tap/dataglot
```
{% </code_tabs> %}

Point it at a database you already have, connect with plain `psql`, and run a governed query:

```bash
psql "host=localhost port=5432 user=demo dbname=demo"
```

```sql
SELECT u.email, o.amount
FROM   users u
JOIN   pg_orders.public.orders o ON u.id = o.user_id;
```

You'll see the cross-source join work — and `email` come back masked, because the policy was compiled into the plan before a single row moved.

Each [GitHub release](https://github.com/dataglotai/dataglot/releases) also ships Linux and macOS tarballs with checksums. The [quickstart](/docs/getting-started/) walks through connecting your first sources and writing your first mask, end to end.

## What's next

Near-term work concentrates on connector depth for the sources regulated workloads actually run on, richer governance-platform integrations, and hardening the distributed write path (materializations, compaction, ingestion) on `iceberg-rust`. The [changelog](https://github.com/dataglotai/dataglot/blob/main/CHANGELOG.md) is the honest record — every release documents what landed and what broke.

If plan-time governance over your existing databases sounds like the missing piece in your stack, [star the repo](https://github.com/dataglotai/dataglot), run the [quickstart](/docs/getting-started/), and tell us what breaks. We're building this in the open.
