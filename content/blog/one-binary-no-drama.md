+++
title = "One Binary, No Drama: What a Rust-Native Engine Means for Your Ops"
description = "No JVM to tune, no coordination cluster to babysit, no build step to run — what Dataglot's single-binary design actually buys you in production."
date = 2026-08-14
[taxonomies]
category = ["engineering"]
[extra]
author = "Murat Dursun"
+++

Evaluating a federated query engine usually means evaluating a distributed system you'll have to babysit: a coordinator, a fleet of workers, a coordination service to keep them honest, a runtime with its own tuning discipline, and a wiki page of startup flags that someone on your team becomes the reluctant expert in.

Dataglot is deliberately not that. It's a single static binary. This post is about what that means for the people who have to run it — which, if you're reading this, is probably you.

## One artifact, everywhere

The Dataglot you run on your laptop is the Dataglot you run in production. Pull it and go:

{% <code_tabs labels="Docker, Homebrew"> %}
```bash
docker pull ghcr.io/dataglotai/dataglot
```

```bash
brew install dataglotai/tap/dataglot
```
{% </code_tabs> %}

There's no build step, no toolchain, no "works in the container but not on the VM." The same artifact serves every role: a server speaking the PostgreSQL wire protocol, a one-shot CLI (`dataglot query`) for scripts and CI checks, and an interactive REPL (`dataglot shell`) — the last two run the full engine *in-process*, so you can test a federated query or a masking policy without standing up a server at all.

That has a quiet but real consequence for how teams adopt it: the data engineer trying an idea at 4pm and the platform team running it under SLOs are using the same binary with the same config format. Nothing gets "translated for production."

## No JVM, and why you'll notice

Dataglot has a hard rule: no JVM anywhere in the production runtime. If you've operated JVM-based data infrastructure, you already know the list of things this deletes from your life:

- **No heap sizing.** There is no `-Xmx` to get wrong, no ritual of setting the heap to 70% of the container and hoping the off-heap usage behaves. Memory usage is what the process actually needs.
- **No GC pause archaeology.** Latency spikes don't come with a side quest of correlating them against garbage-collection logs.
- **No warm-up.** The engine starts in milliseconds and is immediately at full speed. That matters more than it sounds: fast starts make crash recovery boring, deploys unremarkable, and autoscaling actually usable.
- **Small containers.** No JDK layer in the image. Smaller pulls, faster cold starts, less surface for your vulnerability scanner to complain about.

None of this is exotic — it's just what you get when the entire engine compiles to native code. Dataglot builds on Apache DataFusion and Arrow, the proven Rust foundation for columnar SQL execution, and spends its own effort on what sits above: federation, governance, and the operational experience.

## Scaling up without changing what you operate

Start on one node — for a lot of governed-federation workloads, one node is genuinely enough, because the heavy lifting is pushed down to the source databases anyway. `EXPLAIN FEDERATION` will show you whole aggregations shipped to the systems that already own the data.

When you do need distributed execution, the story stays calm: the same binary scales out to a scheduler-and-workers cluster, and high availability is coordinated **through the object storage you already run** — no ZooKeeper, no etcd, no Redis quorum to patch, monitor, and page on. If you've carried a pager for any of those, you know exactly how much noise that sentence deletes.

## Fewer moving parts is a governance feature too

There's a compliance angle to all this that's easy to miss. Every extra component in a data platform — the policy sidecar, the UDF registry, the coordination service — is another thing an auditor asks about and another place enforcement can drift. In Dataglot, the engine that plans the query is the engine that enforces the policy, in one process, with the enforcement visible in the plan itself. A smaller system isn't just cheaper to run; it's easier to *prove things about*.

## Try it

Five minutes, no compiler:

```bash
docker pull ghcr.io/dataglotai/dataglot
```

The [quickstart](/docs/getting-started/) takes you from that pull to a governed, cross-source query — and when it works, you'll have deployed the exact artifact you'd take to production.
