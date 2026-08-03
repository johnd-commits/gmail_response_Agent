# Email Parser — Gmail listserv triage agent

A small **scheduled script** (not a chat) that:

1. Pulls new Google Groups listserv emails (individual posts) via the Gmail API.
2. **Parses** each email into a structured post (digest emails still supported as a fallback).
3. **Classifies** each post with the Claude API against your insurance list + criteria.
4. For matches, **creates a Gmail draft** reply — **never auto-sends**.

You review the Drafts folder and send the good ones yourself.

## Files

| File | Purpose |
| --- | --- |
| `config.js` | Insurers, match criteria, signature, Gmail query, model settings |
| `gmailClient.js` | OAuth + list/get messages + create threaded draft (no send helper) |
| `auth.js` | One-time OAuth flow (`npm run auth`) → `token.json` + refresh token |
| `digestParser.js` | Parses individual group emails (and digests) into `{topic, sender, snippet, link, body}` |
| `classifier.js` | Sends a post to Claude, returns `{matches, reason, draftReply}` |
| `index.js` | Orchestrates fetch → parse → classify → draft, with dry-run + logging |
| `.github/workflows/triage.yml` | Hourly cron on GitHub Actions |

## Setup

### 1. Install
```bash
npm install
```

### 2. Google Cloud + Gmail API
1. Create a project at https://console.cloud.google.com/
2. **APIs & Services → Library →** enable **Gmail API**.
3. **OAuth consent screen:** External, testing mode; add your Gmail as a **test user**.
4. **Credentials → Create Credentials → OAuth client ID → Desktop app.** Download the JSON.
5. Save it as `credentials.json` in the project root (gitignored).

### 3. Anthropic API key
Get a key at https://console.anthropic.com/ (API billing is separate from claude.ai).
Copy `.env.example` → `.env` and set `ANTHROPIC_API_KEY`.

### 4. Authorize Gmail (one time)
```bash
npm run auth
```
This opens the consent screen, saves `token.json` locally, and prints a
`GMAIL_REFRESH_TOKEN` to add to `.env` (and to GitHub Actions secrets for CI).

### 5. Configure
Edit `config.js`: confirm `acceptedInsurers`, tune `gmailQuery`, and **replace the
`signature` placeholder** with your real name/practice/contact.

## Run

```bash
# Safe: classify + print proposed drafts, but create nothing
npm run dry-run

# Real: create Gmail drafts for matches (still never sends)
npm start
```

Test the parser against saved digests (drop `.txt`/`.eml` files in `./samples`):
```bash
npm run parse:sample
```

Logs are written to `triage.log`.

## Scheduling (GitHub Actions)
`.github/workflows/triage.yml` runs daily. Add repo **Settings → Secrets and
variables → Actions**:
`ANTHROPIC_API_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

## Safety rails
- **Drafts only.** There is intentionally no `messages.send` helper.
- **Dry-run mode** (`--dry-run` / `DRY_RUN=true`) logs proposed drafts without creating them.
- Skipped posts are logged with the reason so you can spot-check the filter.
- Secrets (`credentials.json`, `token.json`, `.env`) are gitignored.
"# gmail_response_Agent" 
