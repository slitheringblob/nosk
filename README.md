# nosk

**Your Obsidian vault, on every device.**

nosk opens your Obsidian vault straight from its GitHub repo, in any browser: laptop, desktop or
phone. Nothing to install, no sync subscription, no server. Your notes stay plain markdown in a
repo you own, and Obsidian keeps working exactly as before.

![nosk showing a note with properties, a callout, tasks and code](docs/screenshot.png)

## What it does

- **Write anywhere.** Edit notes in markdown with list continuation, `[[link]]` suggestions and
  a formatting bar on your phone. Tick tasks straight from reading view. Create, rename and delete
  notes, drag files and folders around the sidebar (every link to them keeps working), and open
  today's note in your vault's own daily format.
- **Safe with Obsidian.** Changes are saved on your device instantly and committed to GitHub a
  few seconds later. If Obsidian changed the same note meanwhile, both edits are merged; if you
  both changed the same lines, yours is kept and theirs is saved next to it. Nothing is lost.
- **Instant, and offline.** The first visit downloads your vault in seconds. After that it opens
  from your device and checks GitHub for changes with a single request. No signal? Keep reading
  and writing; edits sync when you're back.
- **Reads Obsidian like Obsidian.** Wikilinks and aliases, embedded notes and images, callouts,
  tasks (including custom states), tags, highlights, math, code, properties and backlinks.
- **Find anything.** Jump to a note with `⌘K`, search every word with `/`, filter by `#tag`.
- **Your folders, as they are.** The sidebar mirrors the vault's folders, with a filter that
  matches as you type.
- **Private by design.** Your token stays in your browser and only ever talks to
  `api.github.com`. No accounts, no analytics, nothing in between.
- **Feels like an app on your phone.** Add it to your home screen and it opens full-screen.

<p align="center"><img src="docs/phone.png" alt="nosk on a phone" width="300"></p>

## Get started

1. Create a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new)
   with access to **only your vault repo** and **Contents: Read and write**.
2. Open nosk in your browser.
3. Enter your vault repo (`you/your-vault`) and paste the token. That's it.

## What's next

- **Templates**: start a note from your vault's templates folder.
- **History**: browse and restore any earlier version of a note from git.

## Run it yourself

nosk is a static site with no build step.

```bash
cd frontend && python3 -m http.server 3000   # open http://localhost:3000
cd frontend && npm install && npm test        # tests
```
