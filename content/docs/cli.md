+++
title = "Command line & REPL"
description = "Run federated, governed SQL straight from your terminal — one-shot queries, an interactive shell, and scripting-friendly CSV/JSON output, no server required."
weight = 15
+++

The `dataglot` binary is also a command-line SQL client. `dataglot query`
and `dataglot shell` run the **full engine in-process** — federation,
plan-time masking and row filters, the `pg_catalog` overlay — without
starting a server or opening a port. Install the binary, point it at a
config, and you're querying.

```bash
dataglot query -c dataglot.toml "SELECT * FROM pg.public.users LIMIT 5"
```

## `dataglot query` — one statement, then exit

```text
dataglot query [SQL] [-f <file>] [--format table|csv|json] [--user <name>] [-c <config>]
```

The SQL can come from three places (first match wins):

1. `--file report.sql` — read from a file
2. a positional argument — `dataglot query "SELECT 1"`
3. stdin — pass `-`, omit the argument, or just pipe:

```bash
echo "SELECT count(*) FROM pg.public.orders" | dataglot query -c dataglot.toml -
```

Results go to **stdout**; everything else (status, errors) goes to stderr,
so output pipes cleanly. The process exits `0` on success and non-zero on
any failure — a bad statement, an unreachable catalog, or no SQL provided —
which makes it safe to use in scripts and CI with `set -e`.

Governance is not optional on this path: the embedded session applies the
same plan-time masks and row filters the server enforces, so a one-shot
extract can never leak what a `psql` session couldn't see.

### Output formats

| `--format` | What you get | Good for |
|---|---|---|
| `table` (default) | Aligned ASCII table, like `psql` | Reading in the terminal |
| `csv` | Comma-separated values **with a header row** | `csvkit`, spreadsheets, `\copy` |
| `json` | One JSON object per row (newline-delimited, NDJSON) | `jq`, log pipelines |

```bash
dataglot query -c dataglot.toml --format json "SELECT id, email FROM users" | jq .email
```

### Flags

| Flag | Meaning |
|---|---|
| `-c, --config <path>` | Config file (also `DATAGLOT_CONFIG`); global — works before or after the subcommand |
| `-f, --file <path>` | Read the SQL from a file (mutually exclusive with the positional argument) |
| `--format <fmt>` | `table` \| `csv` \| `json` (default `table`) |
| `--user <name>` | Identity for the session — sets what `current_user` / `session_user` return (default `dataglot`) |
| `--tolerate-unreachable-catalogs` | Skip sources that are down instead of failing |

Config resolution follows the same precedence everywhere: **CLI flag > env
var > config file > default**.

## `dataglot shell` — the REPL

```bash
dataglot shell -c dataglot.toml
```

An interactive shell over the same embedded engine. Type a SQL statement
on one line and press Enter; quit with `\q`, `quit`, `exit`, or Ctrl-D.

```text
dataglot shell — type SQL and press Enter; \q or Ctrl-D to quit.
dataglot> SELECT u.email, o.amount FROM users u JOIN pg_orders.public.orders o ON u.id = o.user_id;
```

- Prompts print to **stderr**, results to **stdout** — so even the REPL
  can be driven by a script and its output captured cleanly.
- A statement error prints and the shell keeps going; only a fatal stdin
  error ends it.
- `--format` and `--user` work exactly as in `query`.

## `dataglot init` — scaffold a config

```bash
dataglot init                # writes ./dataglot.toml
dataglot init custom.toml    # custom path
dataglot init --force        # overwrite an existing file
```

Writes a commented starter config (one Postgres catalog and a mask
example) and prints the next steps. It refuses to overwrite an existing
file unless `--force`. `dataglot --print-example-config` streams the same
content to stdout instead, for piping or inspection.

## Shell completions

{% <code_tabs labels="bash, zsh, fish"> %}
```bash
dataglot completions bash > /etc/bash_completion.d/dataglot
```

```bash
dataglot completions zsh > "${fpath[1]}/_dataglot"
```

```bash
dataglot completions fish > ~/.config/fish/completions/dataglot.fish
```
{% </code_tabs> %}

## Health probe

`dataglot --healthcheck` performs a fast TCP connect to the server port
(default `5432`, `--port` to override) and exits `0`/`1` — the same
contract as `nc -z`, but available inside shell-less container images.
It's what the container image's `HEALTHCHECK` uses.

## Where next

- [Data pipelines from the command line](/guides/cli-data-pipelines/) —
  composing `dataglot query` with `jq`, csvkit, `psql`, cron, and CI.
- [Configuration file](/docs/configuration/) — the full `dataglot.toml`
  reference the CLI loads.
- [Runtime configuration](/docs/runtime-config/) — the SQL DDL surface
  (`CREATE CATALOG`, `CREATE MASK`, …). Note: runtime DDL is handled on the
  server's wire-protocol path, so it needs a running server and a Postgres
  client — the in-process `query`/`shell` sessions read their sources from
  the config file.
