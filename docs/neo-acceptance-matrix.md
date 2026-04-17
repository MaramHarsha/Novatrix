# Neo public-doc parity checklist (Novatrix)

Maps shipped behaviors in the **Novatrix** codebase to ProjectDiscovery Neo documentation (behavioral parity, not source parity).

| Neo doc theme | Implementation | Status |
|---------------|----------------|--------|
| [How Neo Works](https://docs.neo.projectdiscovery.io/essentials/how-neo-works) — objective → execution | Chat + `runAgentTurn` tool loop | Done |
| [Sandboxes](https://docs.neo.projectdiscovery.io/concepts/sandboxes) — isolation, streaming, artifacts | Docker `docker run` + workspace mount + stdout stream; `SANDBOX_DOCKER_NETWORK` | Done |
| [Capabilities / Tools](https://docs.neo.projectdiscovery.io/concepts/tools) | `terminal_exec`, `http_request`, `browser_navigate`, manifest summary in system prompt | Done |
| [Evidence & Reports](https://docs.neo.projectdiscovery.io/concepts/evidence-and-reports) | `Finding` model, `record_finding`, `REPORT.md` worker export | Done |
| [Memory](https://docs.neo.projectdiscovery.io/concepts/memory) | Embeddings + `MemoryEntry` cosine retrieval (JSON vectors; pgvector-ready DB image) | Partial |
| [Connecting Your Stack](https://docs.neo.projectdiscovery.io/essentials/connecting-your-stack) | Slack/GitHub POST routes + integration status | Partial |
| [Scheduling](https://docs.neo.projectdiscovery.io/concepts/scheduling) | `Schedule` model + Redis/BullMQ hook (cron execution external) | Partial |
| [Security & Privacy](https://docs.neo.projectdiscovery.io/concepts/security-privacy) | Optional `MUTATION_API_KEY`, allowlists, audit log | Partial |
