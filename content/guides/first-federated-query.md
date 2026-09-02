+++
title = "Your First Federated Query"
description = "From install to a governed, cross-source SQL query in minutes — your own databases, one PostgreSQL endpoint, and a masking policy that rides along with every JOIN."
weight = 10

[extra]
topic = "Federation"
level = "Beginner"
+++

This tutorial takes you from install to a governed, cross-source SQL query in
a few minutes, against **your own databases**. Everything runs from prebuilt
artifacts — no toolchain, no compilation.

You need Docker (or Homebrew) and a Postgres you can point at; `psql` or any
Postgres client to connect.

## 1. Install and start

Pick either channel (the [install page](/docs/install/) lists them all):

{% <code_tabs labels="Docker, Homebrew"> %}
```bash
docker run --rm -p 127.0.0.1:5432:5432 ghcr.io/dataglotai/dataglot:latest
```

```bash
brew install dataglotai/tap/dataglot && dataglot
```
{% </code_tabs> %}

Dataglot starts in milliseconds and speaks the PostgreSQL wire protocol on
port **5432**.

## 2. Connect

Any Postgres client works — no special driver:

```bash
psql -h 127.0.0.1 -p 5432 -U demo -d dataglot
```

(Out of the box the username is a policy *identity*, not a credential — the
default `trust` mode is for local use; [authentication](/docs/authentication/)
covers md5, SCRAM, JWT, and LDAP for anything shared.)

## 3. Register your sources — in SQL

No config file needed. Point a catalog at your Postgres, straight from the
session:

```sql
CREATE CATALOG pg WITH (kind = 'postgres', dsn = 'host=db port=5432 dbname=app');
```

The source is validated before anything is persisted — an unreachable DSN
fails the statement immediately. The catalog is live in the same session:

```sql
SELECT email FROM pg.public.users LIMIT 3;
--        email
-- ---------------------
--  alice@example.com
--  bob@corp.example
--  carol@example.org
```

Have a second database? Register it the same way and JOIN across both in one
statement — MySQL, another Postgres, Snowflake, object storage, or Iceberg:

```sql
CREATE CATALOG shop WITH (kind = 'mysql', dsn = 'mysql://svc@mysql:3306/shop');

SELECT u.email, s.segment, s.region
FROM   pg.public.users        u
JOIN   shop.shop.segments     s ON u.id = s.user_id
ORDER  BY s.segment;
```

One endpoint, several engines, one SQL statement — and no data copied
anywhere.

## 4. Add governance — also in SQL

Mask a column and filter rows with two statements:

```sql
CREATE MASK email_mask ON pg.public.users ( email ) AS '***@example.com';
CREATE ROW FILTER eu_only ON pg.public.orders USING ( region = 'EU' );
```

The same query from step 3 now comes back masked:

```sql
SELECT email FROM pg.public.users LIMIT 3;
--       email
-- -------------------
--  ***@example.com
--  ***@example.com
--  ***@example.com
```

The mask is compiled into the query plan itself, so it also rides along with
every JOIN — including the cross-source one above. There is no client, no
BI tool, and no clever subquery that gets around it, because the masked
column is never fetched from storage in the first place.

Typed masks are available too (`show_last`, `hash`, `redact`, …):

```sql
CREATE MASK ssn_mask ON pg.public.users ( ssn ) WITH ( type = 'show_last', keep = 4 );
```

## 5. See the pushdown

`EXPLAIN FEDERATION` shows what Dataglot ships to each source instead of
computing locally:

```sql
EXPLAIN FEDERATION
SELECT user_id, SUM(amount) AS total_amount, COUNT(*)
FROM pg.public.orders
GROUP BY user_id
ORDER BY total_amount DESC;
```

Look for the `VirtualExecutionPlan` node — the **entire aggregation** goes to
the source as SQL, not just the scan:

```text
VirtualExecutionPlan name=postgres://…@db:5432/app
  base_sql=SELECT "orders"."user_id", sum("orders"."amount") AS "total_amount",
           count(1) AS "count(*)" FROM "public"."orders"
           GROUP BY "orders"."user_id" ORDER BY "total_amount" DESC NULLS FIRST
```

The plan trace also shows the `DataglotPolicyEnforcer` pass — the masks and
filters from step 4 are baked into the plan, not applied after the fact.

## 6. Per-user governance — same SQL, different identity

Masks and filters can also attach to *tags* and dispatch by who connected,
declared in the server's config:

| Block | What it does |
|-------|--------------|
| `governance.tags` | Declares the `pii` tag. |
| `governance.policies` | Two policies attached to `pii`, both targeting the `analyst` group: a mask rule and a row-filter rule. |
| `governance.columns` | Binds `users.email` to the `pii` tag. |
| `identities` | Maps usernames to groups: `alice → [analyst]` activates the `pii` policies; `carol → [auditor]` doesn't. |

Now connect as each user and compare:

```bash
psql "host=localhost port=5432 user=alice" -c "SELECT id, email FROM users ORDER BY id;"
psql "host=localhost port=5432 user=carol" -c "SELECT id, email FROM users ORDER BY id;"
```

`alice` sees masked, row-filtered results. `carol` sees everything — same
table, same SQL, different identity.

This is tag-driven governance in microcosm: tag the column once, attach
policies to the tag, and dispatch happens automatically based on who
connected. Adding a third role is one new entry under `policies`, not a
hand-edit of every mask and filter rule that touches the column. The
[plan-time governance guide](/guides/plan-time-governance/) goes deeper.

## Where next

- **Configure your own sources** — the [configuration reference](/docs/configuration/)
  covers every connector kind, policies, TLS, and auth.
- **Manage everything over SQL** — [runtime configuration](/docs/runtime-config/)
  shows `CREATE CATALOG`, `CREATE SECRET`, `CREATE USER`, `GRANT`,
  `CREATE MASK` and friends, so you never edit a config file again.
- **Worked example configs** — the repository's
  [examples/demo](https://github.com/dataglotai/dataglot/tree/main/examples/demo)
  directory carries ready-made `dataglot.toml` files (federation + masking,
  TPC-H) if you'd rather start from a complete config than build one up.
