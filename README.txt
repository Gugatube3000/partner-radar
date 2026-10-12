PARTNER RADAR 3
===============
Choose your Codex / ChatGPT subscription or your Claude subscription in the dashboard.
Research uses your normal subscription allowance. Optional data-service credits are separate.

START
-----
Install Node.js LTS (20+): https://nodejs.org
Install and sign in to ONE provider:
  Codex: npm install -g @openai/codex, then codex login (ChatGPT sign-in).
  Claude Code: https://code.claude.com/docs/en/setup, then run claude and sign in.
Windows: double-click Start Partner Radar.bat
Mac: open Start Partner Radar.command
Terminal: npm ci, then npm start
Open http://localhost:4747 and keep the terminal open.

USE
---
Select a provider, country with flag, institution types and roles.
Use "Want more specific research?" to describe your ideal partner and priorities.
Choose 3-100 firms and 1-8 contacts per firm; start small.
Review the approximate time range before launching; it updates from work completed.
Balanced/deep controls research coverage. Inspect contact evidence before outreach.
Agents follow up on specific missing email, person-profile and current-role evidence.
Excel includes a separate Contacts sheet with individual LinkedIn links and sourced
business phones where available. Shared company lines are labeled separately.
CSV exports each person. The coverage summary explains missing data and next steps.
Demo data is fictional. Saved partial/live results reopen after restart.

CONNECTIONS
-----------
Expand Connections. Get key -> paste into masked field -> Connect -> Test.
Hunter: email discovery/finder/verification; https://hunter.io/api-keys
Apollo: known-person work email enrichment; https://developer.apollo.io/#/keys
Firecrawl: official website reading; https://www.firecrawl.dev/app/api-keys
These vendors have separate credits and account access requirements.
Keys are stored locally in .env and never shown in the browser or committed.

MCP
---
Add MCP registers official Hunter/Apollo remote servers in Codex or Claude Code.
Complete account sign-in using the shown CLI command. Registration and login are separate.
Dashboard enrichment uses API keys; a CLI MCP login alone does not activate it.

EMAIL STATUS
------------
Published: public evidence. Inferred: evidenced format/provider suggestion.
Guess: unconfirmed format. Verified: Hunter valid/deliverable result.
Catch-all: individual mailbox uncertain. Invalid/no mail server: excluded from totals.
An email found by Apollo or an MX DNS record is not automatically Verified.
The app never sends outreach. See README.md for detailed setup and source documentation.
