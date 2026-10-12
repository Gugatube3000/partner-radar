PARTNER RADAR
=============
Pick a country. A small crew of AI agents finds the local banks, wealth managers
and brokerages, scores how good a partner each one is, finds the right person to
talk to, and hands you an Excel sheet sorted by best fit.

It runs on YOUR Claude plan. No API keys, nothing to pay per run.


WHAT YOU NEED (one time)
------------------------
1. Node.js (free): https://nodejs.org  ->  download the "LTS" version and install it.
2. Claude Code, signed in with your Claude account (Pro or Max plan):
   https://claude.com/claude-code  ->  install it, open it once and sign in.


START IT
--------
Windows:  double-click  "Start Partner Radar.bat"
Mac:      right-click   "Start Partner Radar.command"  ->  Open
          (the first time only, macOS asks you to confirm because it was downloaded)

Your browser opens Partner Radar. Keep the small black window open while you use it.
Close that window to stop.


USE IT
------
1. Pick the country and how many firms. It looks for asset managers that invest
   in equities or fixed income, and skips real estate / private-equity-only firms.
2. Click LAUNCH. About 4-5 minutes for 8 firms on Sonnet. Opus is deeper but slower.
3. Click any row on the lead board for the details. Click "DOWNLOAD EXCEL" when it's done.

Start small: one country, 5-10 firms. Big runs use more of your Claude plan's limits.


EMAILS
------
Every email is labeled:
  PUBLISHED  seen on a public page
  INFERRED   built from the firm's email pattern (the example it used is shown)
  GUESS      common format, no example found - double-check before sending
  VERIFIED   checked by Hunter (only if you add a free Hunter key, below)


VERIFIED EMAILS (optional)
--------------------------
To check emails before sending, get a free Hunter key (hunter.io > API) and put it in a file
called ".env" in this folder (copy ".env.example" and fill in the HUNTER_API_KEY line).
