# nosk
tasks and notes that sync across devices seamlessly

nosk is your Obsidian vault on every device, straight from GitHub. It's a static web app: the
browser reads (and soon writes) the vault's GitHub repo through the GitHub API with a
fine-grained token, keeps a full copy in IndexedDB so it opens instantly and works offline, and
renders Obsidian-flavoured markdown (wikilinks, embeds, callouts, tags, tasks, math). Obsidian
keeps working on the same repo. There is no server.

The design and milestones are in [`project_plan/GIT_BACKED_PLAN.md`](project_plan/GIT_BACKED_PLAN.md).
Milestone 1 (read-only vault, search, offline, deploy) is done.

## Run it locally

```bash
cd frontend && python -m http.server 3000
```

Open http://localhost:3000, enter the vault repo (`owner/repo`) and a token:
create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with
access to only the vault repo and **Contents: Read and write**.

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests and publishes `frontend/` on every push to `main`
that touches it.

1. Make this repo public (free Pages needs a public repo; the code holds no secrets, and notes
   and tokens never touch it).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. DNS: add a `CNAME` record `nosk` → `slitheringblob.github.io`.
4. **Settings → Pages → Custom domain**: `nosk.jaydeepganatra.dev`, then tick **Enforce HTTPS**
   once the certificate is issued.

## Tests

```bash
cd frontend && npm install && npm test
```

## The previous version

The FastAPI backend and block editor from the first build are still in `backend/` and
`frontend/legacy.html` (see `project_plan/PROJECT_PLAN.md`). The editor will be reused for
milestone 2; the backend goes away in milestone 5.
