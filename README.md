# Ferrum

**Gym & body-weight tracker — by [Genefty](https://genefty.com).**

Plan your week, run guided workouts, track every set and your body weight.
Optional AI Coach can design or revise a plan; core tracking works without it.

## Product

- App: **Ferrum**
- Publisher: [Genefty](https://genefty.com)
- Passkey profiles, sync, weekly plan, 1,324-exercise library
- Body weight, heatmap, progression rules, plan share/print
- Optional Coach (Claude / Codex / Ollama) — French replies, no medical claims

## Stack

- `frontend/` — React PWA (+ Capacitor mobile)
- `api/` — passkey auth, SQLite state, Coach jobs
- Deployed on Railway; optional local Ollama via private tunnel

## Quick start (dev)

```bash
cd api && npm install && npm start
cd frontend && npm install && npm run dev
```

Set `RP_NAME=Ferrum` (default) and your `ORIGIN` / `RP_ID` for passkeys.
Data lives in `DATA_DIR/ferrum.sqlite` (legacy `db.json` / `state-*.json` are imported once).

## Tests

```bash
cd api && npm test
cd frontend && npm test
cd frontend && npm run test:e2e:install && npm run test:e2e
```

## License note

This product is operated by Genefty. See `LICENSE` / `NOTICE.md` for redistributed components.
