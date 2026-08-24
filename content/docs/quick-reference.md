+++
title = "Quick reference"
description = "One page for running Dataglot: runtime flags and env vars, binaries and topology, the dashboard, and auth modes."
weight = 30
+++

A one-page reference for running Dataglot: runtime options, the process
topology, the dashboard, and auth modes.

Dataglot is a Rust-native federated SQL engine that
queries across Postgres, MySQL, Oracle, Snowflake, Iceberg/lakehouse, object
storage, and OData/REST — over the **PostgreSQL wire protocol**, with plan-time
governance (column masks, row filters). No JVM.

Everything on this page assumes the [prebuilt artifacts](/docs/install/):
stock release binaries and the container image ship with the dashboard and
all pure-Rust connectors (`postgres`, `mysql`, `iceberg`, `snowflake`,
`odata`, `rest`) enabled. A few extras are compile-time options (Oracle via
the native OCI client, bring-your-own ADBC drivers) — see
[Building from source](/docs/building-from-source/) if you need those.

## Runtime options

Every flag has a `DATAGLOT_*` env-var equivalent. Precedence: CLI > env > config
file > default.

| Flag / env | Meaning |
| --- | --- |
| `-H/--host`, `DATAGLOT_HOST` | bind host (default `127.0.0.1`) |
| `-p/--port`, `DATAGLOT_PORT` | pgwire port (default `5432`) |
| `-c/--config`, `DATAGLOT_CONFIG` | config file path |
| `--default-catalog` / `--default-schema` | default namespace |
| `--partitions`, `--batch-size` | parallelism / batch tuning |
| `--tolerate-unreachable-catalogs` | skip sources that are down at boot |
| `--metrics-addr` (default `127.0.0.1:9090`) | Prometheus + dashboard bind addr |
| `--log-format` (`json`\|…), `--log-filter` | logging |
| `--healthcheck` | one-shot TCP probe, exits 0/1 (container HEALTHCHECK) |

Subcommands: `dataglot init` (write a starter config) · `dataglot query "<SQL>"`
(one-shot, in-process, no server) · `dataglot shell` (REPL) ·
`dataglot completions`.

## Binaries & topology

How the binaries interact in **distributed** mode (single-node = the same
server with the scheduler + one *in-process* executor, no external workers):

```text
   psql / JDBC / BI tool          dataglot-testbench
   (any pg client)                (dev dashboard + load-gen)
           │                              │
           │  pgwire (SQL, :5432)         │  pgwire + reads status
           └──────────────┬───────────────┘
                          ▼
        ┌───────────────────────────────────────────┐
        │  dataglot            (dataglot-server bin)  │
        │  pgwire · query planner · policy            │
        │  cluster scheduler   (in-process)           │
        └───────┬───────────────────────────┬─────────┘
        dispatch│ register  gRPC :50060      │ status  REST :50050
                ▼                            ▼
    ┌───────────────────────┐   ┌───────────────────────┐
    │ dataglot-ballista-    │◄─►│ dataglot-ballista-    │
    │ executor  (worker 1)  │   │ executor  (worker N)  │
    └───────────┬───────────┘   └───────────┬───────────┘
       Arrow Flight shuffle between workers (:50061/50071 …)
                │                            │
                │  federated scans (each worker connects to sources)
                ▼                            ▼
        ┌─────────────────────────────────────────────┐
        │ Sources: Postgres · MySQL · Oracle ·         │
        │ Snowflake · Iceberg/lakehouse · object store │
        │ · OData/REST                                 │
        └─────────────────────────────────────────────┘
```

- **`dataglot`** — the only user-facing binary: pgwire ingress, planning, policy
  enforcement, and (with a `[ballista]` config block) the in-process
  scheduler. Single-node servers do the source scans themselves.
- **`dataglot-ballista-executor`** — external worker; registers with the
  scheduler (gRPC), runs plan stages, connects to the federated **sources**
  directly (hence its own catalogs config), and shuffles intermediate data to
  peer executors over **Arrow Flight**.
- **`dataglot-ballista-scheduler`** — standalone scheduler binary, **optional**:
  the server already hosts one in-process, so it's only for a fully-external
  cluster deployment.
- **`dataglot-testbench`** — dev-only: connects over pgwire like any client and
  reads the server's status/REST for the dashboard. Not part of the engine.

## Dashboard

The operational dashboard is served by the engine at
`http://127.0.0.1:9090/ui` — cluster, running queries, sessions,
governance/security posture, connector health, query history. **Served out
of the box** by stock release binaries and the container image (for local
source builds it's a compile-time option — see
[Building from source](/docs/building-from-source/)). Bound at
`--metrics-addr` (default `:9090`); Prometheus metrics at `:9090/metrics`.

## Auth modes

Selected by the `[auth] mode` config key (full detail:
[authentication](/docs/authentication/)).

| Mode | Behaviour | Use for |
| --- | --- | --- |
| `trust` (default) | any username, **no password** | local dev only |
| `md5` | Postgres MD5 password exchange | legacy clients |
| `scram-sha-256` | SASL salted challenge–response (RFC 5802) | production (preferred) |
| `jwt` | client presents a signed JWT as its password; verified `groups` claim drives policy (`[auth.jwt]`) | IdP / token auth |
| `ldap` | bind to the directory as the user; group search drives policy (`[auth.ldap]`) | LDAP / AD |

Options:

- **Identities** (md5/scram): declared under `identities` in config; the password
  is never in the file — `password_env` names an env var read at boot. Optional
  `org` and `groups`.
- **Runtime users:** `CREATE USER … WITH PASSWORD '…'` adds identities live (no
  restart; stored encrypted in the meta store — needs `DATAGLOT_SECRET_KEY`).
- **Multi-org:** identities carry an `org`; usernames are globally unique;
  sessions are org-scoped.
- **TLS:** add a `[pgwire_tls]` block with `mode = "require"` to encrypt the
  session. The server warns if a password mode runs without ingress TLS.
- **Groups / LDAP:** `groups` drive group-conditional masks/row-filters and can
  be populated from LDAP/IdP.

> **Note.** Authorization (what an authenticated user may *see* — masks, row filters,
> GRANT/REVOKE) is separate; see [access control](/docs/access-control/) and
> [runtime configuration](/docs/runtime-config/).
