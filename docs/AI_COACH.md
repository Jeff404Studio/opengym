# The AI Coach

The feature this fork adds to [openGym](https://github.com/DuarteSantos8/openGym): an optional AI
that **designs** your training plan and **revises it from what you actually log** — running as a
CLI on your own server, under your own provider account, off until an admin turns it on.

> The smartest coach is the one running on your own machine.

---

## Why it exists

Upstream openGym progresses a plan flawlessly and cannot write one. The engine adjusts weights
inside whatever structure you built, and the effort ratings you log — RIR, RPE — were, by the
app's own admission, read by nothing. Adherence, stalls and muscle gaps were all *displayed* and
never synthesised into a decision.

The Coach does the two jobs the engine deliberately doesn't: it designs plans, and it changes
them when your training says they should change.

## The boundary that makes it safe

The split is the whole design. Judgement and math live in different places, and the AI never
crosses into the math.

| The Coach — where judgement lives | The Engine — where math lives |
| --- | --- |
| Creates weekly routines | Computes tomorrow's bar weight |
| Sets progression policies | Strictly deterministic |
| Reads RPE / RIR | Applies linear / Greyskull progression |
| Interprets plain-text feedback | Tracks strict hit/miss |
| Adds and swaps exercises | Manages `exWeights` |

**The Coach configures the plan. The Engine calculates the load.** If the AI times out or the
provider dies, the engine carries on offline without skipping a beat.

## Principles

- **Your box, your data.** The provider runs locally; openGym ships no bundled API keys.
- **Opt in twice.** An admin enables the feature; each profile consents separately before any of
  its data is used.
- **Approval required.** Proposals are inert until you tap Apply, one change at a time.
- **Nothing is one-way.** Applying snapshots your plan first; one tap reverts it. Reverting never
  touches a logged workout — the log is what happened.
- **Auditable.** Every trigger, payload summary and decision lands in a per-profile Coach log
  that syncs and travels in your JSON backup.
- **Degrade gracefully.** With the Coach off, the app is byte-for-byte what it was before.

---

## Providers that ship today

| Provider | Runtime | How you sign in | Guide |
| --- | --- | --- | --- |
| **Claude Code** | Claude Agent SDK | `claude setup-token` on a trusted machine, pasted into the admin card | [Coach setup](internal/COACH_SETUP.md) |
| **OpenAI Codex** | Codex CLI (pinned, bundled) | ChatGPT device-code sign-in from the admin card | [Coach setup](internal/COACH_SETUP.md) |
| **Ollama** | local / tunneled HTTP | `OLLAMA_BASE_URL` (+ optional model) in env, then pick Ollama in Admin | [Coach setup](internal/COACH_SETUP.md) |
| **Fixture** | in-repo fake | nothing — no AI account at all | walks the whole loop for demos and CI |

Both runtimes are built into the `api` image, so a self-hoster installs nothing. Neither path
needs an API key. openGym never handles a browser OAuth callback and never asks your users for
credentials.

> **Note.** The design deck describes a provider-agnostic surface including Gemini and an
> owner-supplied custom command. Those adapters were built and then retired before release; a
> stored configuration pointing at either resets to an unconfigured Claude. Adding a provider is
> still one adapter file plus one row in `api/coach/config.js` — nothing else branches on
> provider identity.

---

## Using it

### If you run the instance

1. Enable the Coach and sign in a provider from **Settings → Admin → AI Coach**. No `.env`
   editing, no restart.
2. Set per-profile and instance-wide daily caps *before* inviting people — every plan or review
   is one session billed to the account you connected.
3. The card shows runtime version, sign-in state, jobs run today and the last failure. It never
   shows anyone's intake answers, payloads or proposals.

Full walkthrough: [Coach setup](internal/COACH_SETUP.md) ·
[self-hosting §8](SELF_HOSTING.md#8-the-ai-coach-optional).

`COACH_DISABLED=1` is the kill switch: the Coach reports as disabled everywhere regardless of
what is stored — useful for a fleet.

### If you train on it

**Journey 1 — get a plan.** A six-screen intake (goal, experience, days, session length,
equipment, limitations, likes and dislikes) produces a complete weekly plan: routines, exercise
selection, sets × reps, supersets, the week schedule, and a progression policy per routine. Every
exercise carries a sentence on why it is there. Don't like it? Say so in plain language — *"swap
the squats for split squats, Mondays are short"* — and the plan comes back revised. Applying it
behaves exactly like importing a plan file.

**Journey 2 — the feedback loop.** On demand, weekly, or after every N sessions, the Coach reads
your recent evidence — sets hit and missed against target, effort trends, stalls and deloads the
engine fired, sessions you keep moving, session length against the time you said you had, body
weight against your goal, and muscle groups that got nothing — and returns a list of **discrete
changes**, each with a before → after and a rationale naming the evidence:

> *"Bench came in at RPE ≥ 9.5 for three sessions and stalled twice; swapping to dumbbell press
> for four weeks."*

Tick the ones you want and hit **Apply & Snapshot**. Advice with no plan change attached goes to a
notes section and applies nothing. A review that finds no reason to change anything says so and
sends no notification. Suggestions you turn down are remembered, so the next review doesn't
re-propose them without new evidence.

---

## What actually leaves your server

`api/coach/payload.js` is built as an allowlist: every field is copied in **by name**, nothing is
spread and nothing is passed through, so a field added to the state blob next year cannot ride
along by accident. The five categories it can send — the same list the consent screen renders
from, so the screen cannot drift from the payload — are:

| Category | What it covers |
| --- | --- |
| `plan` | routines, exercises, sets/reps, schedule, progression settings |
| `training` | logged sets, targets, effort ratings, durations, PRs in the review window |
| `bodyweight` | weigh-ins in the window and your goal weight |
| `profile` | the intake answers you gave the Coach, including any limitations |
| `prefs` | unit, language, effort scale |

A review reads a training block, not a training career: the window is capped at **12 weeks or 60
sessions**. Your profile is identified by a stable pseudonym that is never the user id and never
reversible.

Excluded on purpose and permanently: **display name and user id, passkey and credential
material, push subscriptions, invite data, theme and appearance settings, and every other
profile's everything.** Only the math and the effort leave the box.

## Guardrails

- **Persistent memory.** A stated limitation — *"bad right shoulder"* — persists in the Coach
  profile, and every later proposal respects it.
- **Conservative by design.** If pain shows up in free text the Coach will not diagnose. It
  programs conservatively and points you at a professional.
- **Validated before you see it.** Every answer is checked against a closed list of change types
  and the real exercise library — one repair round, then a clean failure. This validator, not the
  prompt, is the security boundary.
- **Contained.** Jobs run as an unprivileged user that cannot read `./data`, with an environment
  built from nothing rather than filtered. Codex's ChatGPT credential stays in its own private
  cache (mounted separately from app data), never in `coach.json`; Claude's setup token is
  encrypted at rest with a key derived from the instance secret.

## Deliberately out of scope

- No AI overriding a per-session load — the engine owns the math.
- No live mid-workout chat or real-time set advice — sessions stay distraction-free.
- No form-video analysis or biomechanical diagnostics — payloads stay minimal.
- No AI in browser-only guest mode — the zero-telemetry promise holds.

---

## Where the code lives

```
api/coach/            config, jobs, payload allowlist, validator, prompts, adapters
frontend/src/lib/coach.js        plan fingerprint, snapshots, atomic apply, revert
frontend/src/views/Coach*.jsx    hub, intake, proposal review
frontend/src/views/AdminCoach.jsx  provider, sign-in, caps, health
```

## Design documents

The shipping design lives in this file and in [docs/internal/COACH_SETUP.md](internal/COACH_SETUP.md).
Earlier strategy decks and `ai-enablement/` planning notes were removed from the tree; treat this
document as the source of truth for what actually shipped.
