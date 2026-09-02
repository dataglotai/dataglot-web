+++
title = "Building from source"
description = "For contributors and the curious: compile Dataglot yourself with a stable Rust toolchain."
weight = 170
+++

You don't need any of this to *use* Dataglot — every release is
[prebuilt](/docs/install/) for macOS and Linux. Build from source when
you want to contribute, patch, or just read the code with a debugger
attached.

## Build

Prereqs: stable Rust (workspace **MSRV 1.94**); `protoc` only if you build the
`ballista` (distributed) feature. No C toolchain is needed for the default
feature set — the production runtime is pure Rust.

```bash
git clone https://github.com/dataglotai/dataglot.git
cd dataglot
```

Then build the server binary (output lands in `target/release/dataglot` or
`target/release-fast/dataglot`) — pick a profile:

{% <code_tabs labels="Release (fat-LTO), Fast iterative"> %}
```bash
cargo build --release -p dataglot-server
```

```bash
cargo build --profile release-fast -p dataglot-server
```
{% </code_tabs> %}

Build profiles: `dev` (fastest) · `release-fast` (optimized, no LTO — the
dev/demo default) · `release` (fat-LTO, what the shipped container uses).

Dev gates before a PR:

```bash
make check     # fmt + clippy + taplo
make test      # workspace tests (non-Docker)
make ci        # full pre-PR gate (check + test + doc + deny)
```

To launch your build (single node, or a local distributed cluster — the
distributed launcher defaults to 1 server + 2 executors; set `EXECUTORS=N`
to change the worker count):

{% <code_tabs labels="Single node, Distributed cluster"> %}
```bash
./scripts/run-single.sh
```

```bash
./scripts/run-distributed.sh
```
{% </code_tabs> %}

## Compile-time options (Cargo features)

Connectors and subsystems are feature-gated — build only what you need.
(Stock release binaries and the container image ship with the dashboard and
all pure-Rust connectors enabled; these knobs matter only for your own
builds.)

**`dataglot-server`:** `dashboard` (embedded ops UI at `/ui`; off for a bare
`cargo build` — enable with `--features dashboard`) ·
`ballista` (distributed execution, needs `protoc`) · `oracle` (Oracle
via OCI/ODPI-C, native C client at runtime) · `oracle-pure` (Oracle, pure-Rust,
no C).

**`dataglot-federation` connectors:** `postgres` · `mysql` · `iceberg` · `odata`
· `rest` · `snowflake` · `adbc` (bring-your-own ADBC driver) · `oracle` /
`oracle-pure`. Shortcut: `all = postgres,mysql,iceberg,odata,rest`.

{% <code_tabs labels="Pick features, All features, With cluster binaries, Whole workspace"> %}
```bash
cargo build --release -p dataglot-server --features "dashboard,ballista,dataglot-federation/all"
```

```bash
cargo build --release -p dataglot-server --all-features
```

```bash
cargo build --release -p dataglot-server -p dataglot-ballista --all-features
```

```bash
cargo build --release --workspace --bins --all-features
```
{% </code_tabs> %}

- **Pick features** — name exactly the features you want.
- **All features** — everything on for the server binary (distributed +
  dashboard + oracle/adbc/flight_sql + all connectors); needs `protoc` and a
  C compiler (the OCI `oracle` feature builds ODPI-C).
- **With cluster binaries** — the server's `ballista` feature only links the
  library; this also builds `dataglot-ballista-executor` (external worker)
  and `dataglot-ballista-scheduler` (standalone scheduler, optional — the
  server hosts one in-process).
- **Whole workspace** — every binary with everything on; the heaviest build.

The 3 workspace binaries: `dataglot` (`dataglot-server`) · `dataglot-ballista-executor`
and `dataglot-ballista-scheduler` (`dataglot-ballista`). Building **all** with
`--all-features` pulls the heaviest toolchain set: `protoc` (ballista) and a
**C** compiler (OCI `oracle`/ODPI-C).

Default build (`-p dataglot-server`, no `--features`) always compiles the
pure-Rust connectors — `postgres`, `mysql`, `iceberg`, `snowflake`, `odata`,
`rest` — and leaves `ballista`, `dashboard`, `oracle`, `oracle-pure`, `adbc`,
and `flight_sql` off.

## Try your build

A cold build takes 15–20 minutes; incremental rebuilds are fast. The
`release-fast` profile puts the binary at `target/release-fast/dataglot`
(`target/release/dataglot` for `--release`, `target/debug/dataglot` for a
plain `cargo build`).

The quickest check needs no config and no sources — the server boots with
no catalogs and you create them over SQL, exactly as in the
[quickstart](/docs/getting-started/):

```bash
./target/release-fast/dataglot
```

The repository also ships worked example configs in
[`examples/demo`](https://github.com/dataglotai/dataglot/tree/main/examples/demo)
— Postgres + MySQL catalogs with masks, row filters and derived products
(`dataglot.toml`), a TPC-H setup, a lakehouse, and a Snowflake variant.
Each names its credentials through `*_env` variables rather than inlining
them, so export those before booting:

```bash
export DEMO_PG_DSN='host=localhost port=5432 user=me dbname=app'
export DEMO_ORDERS_DSN='host=localhost port=5433 user=me dbname=orders'
export DEMO_MYSQL_DSN='mysql://me:pw@localhost:3306/app'
./target/release-fast/dataglot --config examples/demo/dataglot.toml
```

## Contributing

See
[CONTRIBUTING.md](https://github.com/dataglotai/dataglot/blob/main/CONTRIBUTING.md)
for the development workflow; `make check` and `make test` are the local
gates the CI also runs.

