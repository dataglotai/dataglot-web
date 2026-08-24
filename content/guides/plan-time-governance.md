+++
title = "Plan-Time Governance in Practice"
description = "How Dataglot decides who may connect, what they may read, and what they see — masks, row filters, grants, and typed tags, all enforced inside the query plan with no path around them."
weight = 20

[extra]
topic = "Governance"
level = "Intermediate"
+++

This guide walks the three layers of Dataglot's access control — authentication, authorization, and governance — and shows them composing end to end with runnable SQL. It's a practical companion to the [access control](/docs/access-control/) and [runtime configuration](/docs/runtime-config/) reference pages.

## The design in two properties

Access control in Dataglot is three distinct layers, applied in order:

1. **Authentication** — *who you are*. The pgwire login (`trust` / `md5` / `scram-sha-256` / `jwt` / `ldap`).
2. **Authorization (GRANT)** — *which objects you may read*. Deny-unless-granted privileges on catalogs and tables.
3. **Governance** — *what you see in the rows you are allowed to read*. Column masks, row filters, and access-deny rules.

Two properties hold across all three, and they are the whole design:

- **Plan-time enforcement.** Every layer is enforced on the logical plan before execution — masks and filters are typed expressions baked into the plan, not UDFs or post-hoc SQL rewriting. There is no execution path that skips them.
- **Fail-closed.** A missing credential, a missing grant, or any store/decrypt error denies rather than allows. You opt *out* of enforcement (the permissive `trust`/`open` defaults), never *into* a leak.

## Layer 1 — Authentication

The `[auth] mode` bootstrap key selects how a connection proves its username:

- **`trust`** (default) — no password check; the asserted username is believed. Local dev only; never on a reachable network.
- **`md5`** — Postgres MD5 password exchange.
- **`scram-sha-256`** — Postgres SCRAM-SHA-256 salted challenge–response. It authenticates against the *same* credentials as md5, so switching is a one-line config change; prefer it on any shared deployment because nothing replayable crosses the wire.
- **`jwt`** — the client presents a signed JWT as its password; its verified `groups` claim drives directory-group policy.
- **`ldap`** — the connection binds to the directory as the user; a group search drives directory-group policy.

Authentication is fail-closed: an unknown user, a passwordless user, and a wrong password all fail identically, and the reason is never logged.

## Layer 2 — Authorization

Authentication proves *who* you are; authorization decides *what you may read*. One bootstrap key governs it:

```toml
[authz]
mode = "grant"   # "open" (default) | "grant"
```

In `grant` mode the model is **deny-unless-granted**: to read `catalog.schema.table`, a session must hold **both** `USAGE` on the catalog **and** `SELECT` on the table. Missing either, the query is rejected at plan time with `permission denied` — revealing nothing about whether the object exists.

```sql
GRANT USAGE  ON CATALOG pg      TO analyst;
GRANT SELECT ON pg.public.users TO analyst;
```

The key rules:

- **Principals.** A grant applies when its grantee equals the session user or one of the session's roles. `GRANT <role> TO <user>` establishes membership.
- **Org-scoped.** A grant made in one organization never authorizes a same-named principal in another. Cross-org isolation is enforced, not conventional.
- **Superuser bypass.** A superuser session skips grant enforcement entirely — but **not** masks or row filters (see below).
- **Introspection exempt.** `pg_catalog` and `information_schema` are always readable, so `\dt`, JDBC metadata, and BI catalog browsing work without explicit grants. A bare reference like `FROM users` is resolved to its full `catalog.schema.table` identity *before* the check, so qualifying (or not qualifying) a name can never dodge enforcement.

A `GRANT`/`REVOKE` applies to the session's **next** query — no reconnect. Role membership resolves at connect time.

## Layer 3 — Governance

Once a read is authorized, governance decides what the rows actually contain. Three enforcers, all plan-time:

- **Column masks** — a matching column is replaced by its mask expression **only in the output projection**. Predicates, joins, sorts, and aggregates see the *unmasked* value — the industry-standard "option A" semantics, matching Snowflake, BigQuery, and Databricks dynamic data masking. So `WHERE email = 'alice@…'` still finds Alice's row even though `email` comes back masked in the result.
- **Row filters** — a mandatory boolean predicate baked into every scan of the target table. Predicate pushdown collapses it into the source scan where possible; where not, it is evaluated locally. Either way it is not optional and there is no caller-side path around it.
- **Access-deny** — reject the query outright. Table-level denies any scan; column-level denies any *reference* to the column (projection, predicate, `SELECT *`). Both are group-scoped.

**Deny vs grant.** They answer different questions and both must pass. Grant is *deny-unless-granted* — you need a positive privilege to read at all. Access-deny is a *negative* rule that subtracts a specific table or column from a group even where a broader read would otherwise be allowed.

**Superuser and governance.** A superuser bypasses grants but **not** masks, row filters, or access-deny. Governance controls are *guarantees about the data*, not access privileges — a masked SSN stays masked for everyone, including the superuser. The mask is a property of the column, not of the caller.

## How the layers compose

Walk a single `SELECT email FROM pg.public.users` through the stack:

| Session | Authentication | Authorization (`grant`) | Governance | Result |
|---|---|---|---|---|
| Unauthenticated | fails login | — | — | **connection refused** |
| Authenticated, no grant | ok | no `USAGE`+`SELECT` | — | **`permission denied`** |
| Authenticated, granted | ok | privileges held | mask on `email` | **rows returned, `email` masked** |
| Superuser | ok | skipped | mask on `email` | **rows returned, `email` still masked** |

The precedence is always the same: authenticate, then authorize, then govern. A later layer never re-opens an earlier one — a grant does not un-mask, and superuser does not un-mask.

## The no-bypass guarantee

Grants, masks, row filters, and denials are not surface-level checks on the top-level query — they hold **wherever a governed table is reached in the plan**. Two paths that naive engines leak through are closed:

- **Through subqueries.** A governed scan reached only inside a scalar subquery, an `IN`/`EXISTS` test, a `= ANY` comparison, or a nested subquery is governed exactly as a top-level scan. The enforcers descend into subquery-bearing expressions explicitly, because a default plan walk does not — skipping them would be a silent read-around.
- **Through views.** `CREATE VIEW` stores a derived product whose defining plan is **inlined** at query time. Governance re-applies to the inlined plan, so a mask, filter, or grant on an underlying source column holds when you query the view instead of the source.

You cannot escape a control by wrapping the read in a subquery or a view. This is enforced by construction and regression-tested.

## End-to-end example

A complete session showing all three layers.

### 1. Boot with md5 auth and grant-mode authorization

```toml
host = "127.0.0.1"
port = 5432

[catalog_service]
path = "/var/lib/dataglot/meta.redb"

[auth]
mode = "md5"

[authz]
mode = "grant"

[identities.admin]
password_env = "DATAGLOT_PW_ADMIN"
```

```bash
export DATAGLOT_PW_ADMIN='admin-bootstrap-pw'
export DATAGLOT_SECRET_KEY="$(openssl rand -base64 32)"
dataglot --config bootstrap.toml
```

### 2. As admin, wire up a source, a role, and a runtime user

```sql
CREATE SECRET  app_pg_dsn AS 'host=db port=5432 dbname=app user=svc password=hunter2';
CREATE CATALOG pg WITH (kind = 'postgres', dsn_secret = 'app_pg_dsn');

CREATE ROLE reporting;
CREATE USER analyst WITH PASSWORD 'correct horse battery staple';
GRANT reporting TO analyst;
```

### 3. As analyst, the read is denied — nothing granted yet

```sql
SELECT email FROM pg.public.users LIMIT 3;
-- ERROR:  permission denied
```

### 4. Back as admin, grant the two privileges a read requires

```sql
GRANT USAGE  ON CATALOG pg      TO reporting;   -- reach the catalog
GRANT SELECT ON pg.public.users TO reporting;   -- read the table
```

### 5. As analyst, the same query now returns rows

Grants apply on the next query — no reconnect needed:

```sql
SELECT email FROM pg.public.users LIMIT 3;
--        email
-- ---------------------
--  alice@example.com
--  bob@corp.example
--  carol@example.org
```

### 6. As admin, add a mask — the authorized read now returns masked

```sql
CREATE MASK email_mask ON pg.public.users ( email ) AS '***@example.com';
```

```sql
-- as analyst, the same authorized query:
SELECT email FROM pg.public.users LIMIT 3;
--       email
-- -------------------
--  ***@example.com
--  ***@example.com
--  ***@example.com
```

Authorization decided *whether* `analyst` could read; governance decided *what* the rows contained. A superuser at step 5 would have skipped the grant checks — but at step 6 would still see the masked value.

## Config vs runtime DDL

Every control can be declared in the bootstrap config **or** created at runtime over SQL DDL (persisted to the meta store, org-scoped). Both routes reach the same plan-time enforcers.

| Control | Config | Runtime DDL |
|---|---|---|
| Authentication mode | `auth.mode` | — (bootstrap only) |
| Login identity | `identities.<user>` | `CREATE / ALTER / DROP USER … PASSWORD` |
| Authorization mode | `authz.mode` | — (bootstrap only) |
| Privilege grant | — | `GRANT USAGE ON CATALOG …` / `GRANT SELECT ON …` / `REVOKE` |
| Role & membership | `identities.<user>.groups` | `CREATE ROLE …` / `GRANT <role> TO <user>` |
| Column mask | `masks[]` | `CREATE / DROP MASK` |
| Row filter | `row_filters[]` | `CREATE / DROP ROW FILTER` |
| Access-deny / tag policy | `governance` | tag-driven; managed via config + webhook |

{% <callout type="success" title="Fail-closed summary"> %}
Authentication denies on any credential error; authorization denies any un-granted read; governance masks, filters, or denies before any row leaves the plan. The defaults (`trust`, `open`, no masks) are permissive by design so a first boot just works — but every enforcement path, once on, denies rather than leaks.
{% </callout> %}

## See also

- [Authentication reference](/docs/authentication/) — auth modes, identities, multi-org, TLS.
- [Runtime configuration](/docs/runtime-config/) — the full runtime DDL surface.
- [Configuration reference](/docs/configuration/) — the bootstrap-config reference.
- [Your first federated query](/guides/first-federated-query/) — the five-minute hands-on demo, including per-user governance.
