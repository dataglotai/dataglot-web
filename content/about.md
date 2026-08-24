+++
title = "About Dataglot"
description = "Who builds Dataglot, why it exists, and how it relates to the rest of your data stack."
template = "page.html"
+++

## What Dataglot is

Dataglot is an open-source, Rust-native federated SQL query engine with
governance enforced in the query plan. It speaks the PostgreSQL wire
protocol, so every client, driver, and BI tool that talks to Postgres talks
to Dataglot — and it queries the databases you already run, in place:
PostgreSQL, MySQL, Oracle, Snowflake, object storage, and Apache Iceberg.

The differentiator is *where* governance happens. Column masks and row
filters are compiled into the physical query plan as typed expressions,
pushed into the scan itself. A masked column is never fetched from storage.
There is no post-processing step to bypass, no SQL-rewrite proxy to route
around — the policy is structural.

## Why it exists

Regulated enterprises — banks, insurers, healthcare providers — sit on data
they are not allowed to move and are audited on how it is accessed. The
tools they use to *define* policy (data catalogs and governance platforms)
are mature. The layer that *enforces* those definitions at query time, across
every source and every client, is what's been missing. Dataglot is that
layer: your governance platform defines what PII means in your organization;
Dataglot is where that definition becomes a query-time guarantee.

## What Dataglot is not

Dataglot is not a SaaS data-integration tool. Products like Airbyte,
Fivetran, and Hightouch exist and are excellent at moving data. Dataglot is
the governance-enforcing query layer above the data you keep in place, and
it partners with — never competes with — the governance platforms where
policy is authored.

## Who builds it

Dataglot is built by [Peaka](https://www.peaka.com) and developed in the
open at [github.com/dataglotai/dataglot](https://github.com/dataglotai/dataglot)
under the Apache-2.0 license. It stands on the shoulders of Apache
DataFusion, Apache Arrow, Apache Iceberg, and Apache Ballista.

We didn't invent a paradigm. We built cleanly on the one that won.

## Get in touch

- Issues and discussions: [GitHub](https://github.com/dataglotai/dataglot)
- Security reports: see [SECURITY.md](https://github.com/dataglotai/dataglot/blob/main/SECURITY.md)
