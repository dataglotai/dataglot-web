+++
title = "The One Line That Cannot Move"
description = "Why governance enforcement has to be structural — compiled into the query plan — and why post-parse SQL rewrites will never get you there."
date = 2026-08-20
[taxonomies]
category = ["engineering"]
[extra]
author = "Murat Dursun"
+++

Every data governance program has the same load-bearing sentence somewhere in its documentation: *"columns classified as PII are masked for unauthorized users."* The classification half of that sentence is a solved problem — DataHub, Informatica, Collibra and their peers are genuinely good at capturing what PII means in your organization, who owns it, and what policy should apply to it.

The enforcement half is where the sentence quietly becomes fiction. This post is about why, and about the design decision at the center of Dataglot: **policy is compiled into the physical query plan, and that is the one line in the architecture that cannot move.**

## How enforcement actually works today

Walk into any regulated enterprise and ask how a PII tag becomes runtime behavior. You'll find some combination of four mechanisms:

**Post-parse SQL rewrites.** A policy agent intercepts the query after parsing and injects `WHERE` clauses or wraps columns in masking expressions — as SQL strings. This is enforcement by string manipulation. It has to correctly handle every dialect corner, every subquery shape, every view expansion, every CTE. Miss one and the data walks out. The rewrite is also invisible in the plan: an auditor can't point at the artifact that proves the mask was applied, only at the config that says it should have been.

**UDF-based filtering.** Row filters implemented as user-defined functions — `current_user()` checks, group-membership lookups — deployed to every worker in the cluster. UDFs must be kept in sync across the fleet, they're opaque to the optimizer (so they're also slow), and they're invisible to consumers of the data.

**Ticketing workflows.** Access requests approved by humans. Valuable as process, but a human-in-the-loop workflow is not a structural control; it's a record that someone intended one.

**"The BI tool handles it."** Column-level security configured in the dashboard layer, while every other client — the notebook, the cron job, the AI agent with a database credential — talks to the engine directly.

Auditors know all of this. It's why evidence-gathering for a data-access audit is an archaeology project rather than a query.

## Enforcement at plan time

Dataglot takes a different position. When a query is planned, the session context carries the caller's identity and group memberships. Policies attached to typed tags — `pii.email`, `phi.diagnosis`, whatever your taxonomy says — are resolved at that moment and become **typed expression predicates compiled into the physical scan plan**.

Two properties fall out of this that no rewrite-based system can offer:

**Masked columns are never fetched.** The mask isn't applied to the result set; it replaces the column expression inside the scan itself. If your mask says an analyst sees `***@example.com`, the engine never retrieves the plaintext from storage on that code path. There is no window between "data read" and "mask applied," because there is no such sequence.

**The guarantee is inspectable before execution.** The enforcement pass is a plan node. Run `EXPLAIN` and you can see it:

```sql
EXPLAIN SELECT email FROM users;
-- ...
-- DataglotPolicyEnforcer: mask(email) pushed into scan
```

That plan is the audit artifact. Dataglot also exposes it as an API — `POST /policy/explain` plans a query without executing it and reports exactly which masks, row filters, and deny rules would apply for any identity. "Why was this row excluded?" stops being a forensic question.

## Structural means the edge cases are covered by construction

The difference between structural and best-effort shows up in the unglamorous cases:

- **Subqueries.** A mask that applies to `SELECT email FROM users` must equally apply when the same column is reached through an expression subquery three levels deep. In Dataglot it does, because enforcement operates on the plan — where all of those shapes have already been normalized — not on the SQL text.
- **Derived data.** A masked source column should stay masked in everything computed from it. Dataglot's column-level lineage analysis propagates masks along the lineage graph: a policy on `users.email` automatically covers derived columns that descend from it.
- **Federation.** Policies ride along on cross-source joins. When `users` lives in one Postgres and `orders` in another, the plan that federates them carries the same enforcement nodes as a single-source query.
- **Every client, every protocol.** Because enforcement is in the plan, it's identical for `psql`, a JDBC connection, a dbt run, and an AI agent. There is no privileged path around it.

## The partnership this implies

None of this replaces your governance platform — it's the missing half of it. The division of authority is deliberate: the governance platform is the system of record for classifications, glossary terms, and stewardship decisions; Dataglot is the execution layer where those decisions become behavior. Tag a column as PII in DataHub, and the inbound policy webhook applies the corresponding enforcement in Dataglot within a minute. Every query then emits column-level OpenLineage back, so the catalog stays current with what's actually running.

DataHub defines what PII means in your organization. Dataglot is where that definition becomes a query-time guarantee.

That's the whole thesis. Everything else in the engine — federation, the SQL-native control plane, distributed execution — exists to make that guarantee available over the data estate you already have, without moving the data or rewriting the workloads.

## Try the gap demo yourself

The [five-minute demo](/docs/getting-started/) ships with a masking and row-filter policy on `users.email`. Run the same `SELECT` as a governed identity and watch the plan do the work:

```sql
SELECT id, email FROM users ORDER BY id;

 id |      email
----+-----------------
  2 | ***@example.com
(1 row)
```

Three users exist in the source. A governed session sees one, masked — and `EXPLAIN` will show you exactly why.
