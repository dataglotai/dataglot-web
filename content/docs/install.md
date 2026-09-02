+++
title = "Install"
description = "Prebuilt everywhere: Homebrew, container image, release tarballs, and cargo-binstall. No toolchain, no compiling."
weight = 20
+++

Dataglot ships prebuilt on every channel — you never need a compiler or
a toolchain. All binaries are the `dataglot` server with the default
connectors built in (Postgres, MySQL, Iceberg, Snowflake, OData, REST,
plus object storage, which is always available).

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
docker run --rm -p 127.0.0.1:5432:5432 ghcr.io/dataglotai/dataglot:latest
```

### Which image, which tag

There is **one image** — `ghcr.io/dataglotai/dataglot` — and no variants
to choose between. It is multi-arch (`linux/amd64` and `linux/arm64`,
each built natively), runs on a distroless base as a non-root user, and
includes the operational dashboard.

| Tag | What it points at | Use it for |
|---|---|---|
| `latest` | the newest release | trying Dataglot out |
| `0.5.0` | one exact release | production — pin this |
| `0.5` · `0` | newest patch / newest minor in that line | you want fixes but not surprises |
| `main` · a short commit SHA | the tip of the default branch, or one commit | reproducing a specific build |

The image is also rebuilt nightly, so `latest` and the current release
tags pick up base-image security patches without a version bump.

{% <callout type="info" title="When the image is not enough"> %}
The Oracle and ADBC connectors, distributed execution (Ballista), and
Flight SQL are **not** compiled into the published image — they need a
C runtime, `protoc`, or a driver you supply. Their configuration is
still recognised, so a `kind = "oracle"` catalog fails at boot with a
clear error rather than a confusing one. To use them, [build from
source](/docs/building-from-source/).
{% </callout> %}

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
to a governed, federated query in about five minutes. If you would
rather understand the model first, start with [how Dataglot
works](/docs/how-it-works/).

Want to hack on Dataglot itself? See
[Building from source](/docs/building-from-source/).
