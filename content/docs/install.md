+++
title = "Install"
description = "Prebuilt everywhere: Homebrew, container image, release tarballs, and cargo-binstall. No toolchain, no compiling."
weight = 20
+++

Dataglot ships prebuilt on every channel — you never need a compiler or
a toolchain. All binaries are the `dataglot` server with the default
connectors built in (Postgres, MySQL, Iceberg, Snowflake, OData, REST).

Pick one:

{% <code_tabs labels="Homebrew, Docker, cargo-binstall"> %}
```bash
brew install dataglotai/tap/dataglot
```

```bash
docker pull ghcr.io/dataglotai/dataglot:latest
```

```bash
cargo binstall --git https://github.com/dataglotai/dataglot dataglot-server
```
{% </code_tabs> %}

## Homebrew (macOS / Linux)

Every GitHub Release ships a rendered formula covering macOS
arm64/x86_64 and Linux arm64/x86_64. The installed binary is `dataglot`.

## Container image

```bash
docker run --rm -p 5432:5432 ghcr.io/dataglotai/dataglot:latest
```

## Release tarballs

From [GitHub Releases](https://github.com/dataglotai/dataglot/releases):
`dataglot-<version>-<target>.tar.gz` + `.sha256` for

- `aarch64-apple-darwin` (Apple Silicon)
- `x86_64-apple-darwin` (Intel Mac)
- `aarch64-unknown-linux-gnu`
- `x86_64-unknown-linux-gnu`

```bash
tar xzf dataglot-<version>-<target>.tar.gz
./dataglot-<version>-<target>/dataglot --help
```

## cargo-binstall

Resolves the same prebuilt binaries straight from GitHub Releases — no
compilation involved. The crate is `dataglot-server`; the installed
binary is `dataglot`.

## Next step

Head to the [quickstart](/docs/getting-started/) — from a fresh binary
to a governed, federated query in about five minutes.

Want to hack on Dataglot itself? See
[Building from source](/docs/building-from-source/).
