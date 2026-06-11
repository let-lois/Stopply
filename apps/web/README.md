# LetLois BI web app

Next.js app router project, statically exported and served from
Cloudflare Pages. All data comes from the same origin API Worker
(`/api/*`). See the repository root README for architecture, deploy
commands, and development setup.

```sh
pnpm --filter web dev     # local dev server
pnpm --filter web build   # static export to apps/web/out
```
