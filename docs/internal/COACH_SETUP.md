# Ferrum internal — Coach setup

Enable the Coach from **Settings → Admin → AI Coach**. No restart required.

## Providers

| Provider | What you need |
| --- | --- |
| **Claude Code** | On a trusted machine with Claude Code installed, run `claude setup-token`, then paste the token via **Add CLI token** in the admin card. |
| **OpenAI Codex** | Choose **Sign in with ChatGPT** and complete the device-code flow in a trusted browser. Cache lives in `./data/codex`. |
| **Ollama** | Set `OLLAMA_BASE_URL` (and optional `OLLAMA_MODEL`) in `.env`, restart the API if needed, then select Ollama in Admin. |
| **Fixture** | Built-in fake for demos and CI — no account. |

Hit **Test the Coach** after connecting. Set per-profile and instance daily caps before inviting users.

Public self-host overview: [docs/SELF_HOSTING.md §8](../SELF_HOSTING.md#8-the-ai-coach-optional) · product surface: [docs/AI_COACH.md](../AI_COACH.md).
