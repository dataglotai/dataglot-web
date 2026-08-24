+++
title = "What We Build — and What We Won't"
description = "Dataglot's connector strategy: deep pushdown for the databases regulated workloads run on, a narrow slice of enterprise SaaS, and a deliberate refusal to join the connector-count race."
date = 2026-08-17
[taxonomies]
category = ["engineering"]
[extra]
author = "Burak Doma"
+++

Every federated query engine eventually gets the same question: *"do you have a connector for X?"* Answered case-by-case, that question turns your roadmap into a popularity contest. So we wrote down the rule, and this post is the public version of it.

Our position in one paragraph:

> Dataglot is the federated SQL engine for regulated enterprises. We support the data sources your regulated workloads actually run on — Oracle, SQL Server, Db2, Teradata, HANA, Postgres, MySQL, Snowflake, Iceberg — plus the enterprise SaaS systems that hold related auditable data (SAP, ServiceNow, Workday). We are **not** a SaaS data-integration tool — those exist and are excellent (Airbyte, Fivetran, Hightouch). We are the governance-enforcing query layer above them.

## The decision rule

Connector architecture in Dataglot is dictated by the source, not by preference:

- **If the source has a SQL engine and we want it to do work on our behalf**, we build a SQL-pushdown connector: Dataglot translates plan fragments back into the source's own SQL dialect, and the source executes them natively.
- **If the source's native query interface is not SQL** — REST, OData, key-value, document DSL — we build a native table adapter and translate typed filters into whatever the API accepts.

Why the distinction matters is pushdown. A table adapter can push projection, filters, and limits. A SQL-pushdown connector additionally pushes **aggregations, same-source joins, `ORDER BY`, `DISTINCT`, subqueries, and window functions** to the source. For an aggregation over a terabyte-scale fact table on a database the customer already paid for, that's the difference between shipping one `GROUP BY` query and getting a small answer back, versus pulling every row across the wire. Orders of magnitude in network bytes — and you can verify it, because `EXPLAIN FEDERATION` shows the exact SQL shipped to each source.

That's also why the sources we go deep on are the enterprise SQL engines. They're precisely the systems where pushdown pays: the source is very good at its own data, and Dataglot's job is to route the work there and enforce policy on what comes back.

## Why we won't chase connector count

We could spend the next two years building SaaS connectors. We won't, for four structural reasons:

**Engineering cost with no compounding.** Each SaaS connector is one to two weeks of bespoke OAuth, rate limits, pagination, and schema-discovery quirks. Fifty of them is more than an engineer-year that ships zero improvement to federation, governance, or the connectors regulated workloads depend on.

**No pushdown moat.** SaaS APIs have weak filter capability, so most of the query work happens in the engine anyway. The federation story — "the source does the heavy lifting" — simply doesn't apply when the bottleneck is a paginated REST API.

**Governance doesn't differentiate there.** Regulated-industry sensitive data does not, for the most part, live in Slack, Notion, or Jira. Plan-time masking of a project-management tool is a demo, not a compliance program.

**The breadth race already has winners.** Airbyte has hundreds of connectors; Fivetran has more. Nobody pays a premium for the 87th connector. They pay for the one connector that solves their hard problem.

So when someone asks whether Dataglot supports Slack or HubSpot, the honest answer is: Airbyte and Fivetran do that excellently — land the data in your warehouse or lakehouse, and Dataglot will govern and federate it from there. That's not a dodge; it's the architecture working as intended. Ingestion tools move data; Dataglot is the governed query layer above wherever the data lands.

## The narrow SaaS slice that earns its seat

There is a small set of SaaS systems that genuinely belong in a regulated-enterprise data fabric, because they hold auditable, regulated, or compliance-relevant records:

- **SAP S/4HANA** — ERP and financial transactions, reachable over OData.
- **ServiceNow** — IT change management, the evidence trail for SOX-style controls.
- **Workday** — HR and payroll data, regulated under GDPR/HIPAA for many enterprises.
- **Salesforce and Microsoft Dataverse** — selectively, where CRM records carry customer PII that policies must cover.

Even here we resist bespoke crates. These sources speak OData or a REST-with-filters dialect, so they're built on a shared pair of adapters — one for OData, one for REST — and added as *configuration*, not as new connector codebases. One well-designed adapter, many sources behind it.

## The escape hatch: bring your own ADBC driver

For the long tail, Dataglot ships a generic [ADBC](https://arrow.apache.org/adbc/) connector: point a catalog at any ADBC driver shared library, declare its SQL dialect from the whitelist the engine ships (`postgresql`, `mysql`, `sqlite`, `duckdb`, `bigquery`), and you get full federation pushdown through your own driver — the generic-JDBC idea, minus the JVM.

The contract is deliberately sharp: if your source speaks one of the shipped dialects, yes; otherwise, no. We don't do approximate dialect mappings that generate subtly wrong SQL against your data. When a source lacks a shipped dialect, the fix is landing that dialect upstream in [Apache DataFusion](https://datafusion.apache.org/), the open engine foundation Dataglot builds on — which benefits everyone, not just us.

## The discipline

A connector roadmap is a statement about what you believe your product is. Ours says: Dataglot wins by being *deep* where regulated data lives — pushdown you can inspect, policy compiled into the plan, dialects handled correctly — and by composing cleanly with the excellent ingestion tools that already won breadth. Every engineering week spent on connector number 51 is a week not spent making Oracle pushdown better or closing a governance edge case. We know which of those our users are actually betting on.

If you have a source you think clears the bar, [open an issue](https://github.com/dataglotai/dataglot/issues) — the bar is written down, so the conversation is short either way.
