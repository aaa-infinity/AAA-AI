# Open-Source Knowledge Base

Curated open-source Markdown documents used as a **learning knowledge base** for the
Super AI admin bot's self-improving AI. These files are **not original work** — they are
fetched from public GitHub repositories and kept here for reference/learning. Each file
retains its upstream license; see `SOURCE` notes inline and the table below.

> These docs teach the AI how other open-source projects build AI agents, Cloudflare
> Workers, prompt-engineering patterns, and agentic skills — so it can improve its own
> outputs and suggest fixes for sibling systems.

| File | Source repo | Upstream license | Topic |
|------|-------------|------------------|-------|
| `claude-code-README.md` | [anthropics/claude-code](https://github.com/anthropics/claude-code) | MIT | AI coding agent patterns |
| `cloudflare-workers-sdk-README.md` | [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk) | Apache-2.0 / MIT | Cloudflare Workers SDK |
| `llm-course-README.md` | [mlabonne/llm-course](https://github.com/mlabonne/llm-course) | MIT | LLM / AI learning roadmap |
| `prompt-engineering-guide-README.md` | [dair-ai/Prompt-Engineering-Guide](https://github.com/dair-ai/Prompt-Engineering-Guide) | MIT | Prompt engineering |
| `superpowers-README.md` | [obra/superpowers](https://github.com/obra/superpowers) | (see upstream) | Agentic skills methodology |

## How the AI uses this

- `/teach` and `/learnings` let the admin feed the AI new knowledge.
- On each generation (video/image), the AI records what worked (provider, params) so it
  self-improves and can advise sibling systems.
- These `.md` files are referenced by the ops AI (`/ai`, `/report`) for best-practice
  context when suggesting improvements.

## Attribution

All content under `docs/opensource/` is © their respective authors and covered by the
upstream licenses linked above. This directory is for educational/reference use only.
