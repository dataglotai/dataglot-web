+++
title = "Meta store"
description = "Where runtime control-plane state lives: the embedded redb backend, the Postgres backend, and what is (and isn't) stored."
weight = 120
+++

Everything Dataglot creates **at runtime** — catalogs, secrets, users, roles,
grants, governance policies, and derived products — lives in the **meta store**.
It is the single source of truth for the control plane;
[SQL DDL](/docs/runtime-config/) is the front door. Nothing about a *query's
data* lives here — only the control-plane objects that describe and govern
access.

## Backends

The backend is chosen by the `catalog_service` bootstrap setting (a flag/env,
never itself runtime-mutable):

| Config | Backend | Use |
|---|---|---|
| `{ path = "…/meta.redb" }` | **redb** — single-file, pure-Rust, ACID/MVCC | the zero-dependency default (dev, single-node) |
| `{ dsn = "host=…" }` | **Postgres** + LISTEN/NOTIFY | HA / multi-node |

Both implement the same `MetaStore` trait, so every consumer is backend-agnostic.

The embedded store is [`redb`](https://github.com/cberner/redb) — a
single-file, pure-Rust, ACID store — so the default setup has zero external
dependencies; Postgres is the shared backend for HA and multi-node.

## Distributed mode

The meta store lives **only on the coordinator** (the `dataglot-server`
process). Executors never open it: each executor rebuilds its connectors from a
serialized catalogs config carried in the plan/codec — not from the store. So a
scheduler + N executors touch exactly one meta-store handle, on one host.

This bounds the embedded backend:

- **redb = single-process, single-node.** redb takes an **exclusive OS file
  lock**, so the file can be opened by exactly one process. Within that process
  every `open()` of the same path shares one handle, but a **second server
  process** pointed at the same file is refused the lock. Fine for a single
  coordinator with any number of executors; not for a multi-coordinator (HA)
  control plane.
- **Postgres = multi-node.** A highly-available or multi-coordinator control
  plane must use the `dsn` backend: multiple servers share the state over the
  network and coordinate live changes through LISTEN/NOTIFY.

In short: distribute *execution* freely with redb (executors don't need the
store); distribute the *control plane* only with Postgres.

## redb layout

One table per object kind, keyed by `(org, name)` (`(org, role, user)` for role
membership). Values are `serde_json` bytes, except `secrets` which stores raw
ciphertext.

| Table | Key | Value | Created by |
|---|---|---|---|
| `entries` | `(org, name)` | binding + optional `source_config` | `CREATE CATALOG` |
| `secrets` | `(org, name)` | **ciphertext** (opaque) | `CREATE SECRET` |
| `users` | `(org, name)` | `(opaque password hash, is_superuser)` | `CREATE USER` |
| `roles` | `(org, name)` | — (presence) | `CREATE ROLE` |
| `role_members` | `(org, role, user)` | — (presence) | `GRANT <role> TO <user>` |
| `policies` | `(org, name)` | `(kind, rule)` — mask / row-filter | `CREATE MASK` / row-filter |
| `grants` | `(org, canonical grant)` | `GrantRecord` (set semantics) | `GRANT` |
| `derived_products` | `(org, name)` | name / sql / catalog / schema | `CREATE VIEW` (derived product) |
| `meta` | `schema_version` | version string | bootstrap |

A binding change is published on an in-process broadcast feed, mirroring the
Postgres LISTEN/NOTIFY stream — the provider cache evicts on it so live
sessions see catalog changes immediately.

## What is *not* in the meta store

- **Server bootstrap** — bind host/port, TLS certs, auth mode, and the meta-store
  location itself. These are needed *before* the server accepts SQL, so they stay
  as flags/env, never runtime-mutable.
- **Session/auth tokens** — none are persisted. Auth is per-connection (md5 /
  JWT-verify / LDAP); a JWT is verified, never stored. The only persisted
  credentials are user **password hashes** and source **secrets** (encrypted).

## Security

- **Secrets are ciphertext-only.** Encryption/decryption happens in the server
  (XChaCha20-Poly1305, key from `DATAGLOT_SECRET_KEY`); the store never sees
  plaintext.
- **Passwords are opaque hashes.** Hashed in the server; the store holds
  only the hash, and it is exposed **only** via the auth path — never through
  `list_users`.
- **File permissions.** The redb file is created `0600` on Unix (it holds
  ciphertext + hashes).
- **Value-free diagnostics.** `Debug` and all error text are structural — never a
  stored value.

## GitOps

A SQL-native control plane does not remove version-controlled desired-state:
check in a SQL script (`CREATE CATALOG …` / `CREATE MASK …`) applied at
deploy — the same review/audit surface, in the SQL idiom.
