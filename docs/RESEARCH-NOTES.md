# Why Partner Radar's workflow and interface changed

Research checked on October 12, 2026. These are decisions for this app, not a measured claim that a model now finds a particular percentage more contacts.

## A research desk people can learn quickly

Nielsen Norman Group recommends keeping common choices easy to find while revealing specialist options when needed. This supports a main flow built around the subscription, country, research brief, coverage and Start research button, with settings and diagnostic detail available on demand. [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

Its system-status guidance supports showing the actual stage, completed firms, incomplete evidence and a clear result. Partner Radar adds a planning time range before launch and a remaining-work range during the run. The range can change when a source is slow or evidence needs another pass. [Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/).

The redesign replaces tiny terminal labels and a full-screen neon treatment with larger readable text, clear controls, a restrained research visualization and visible evidence. These are applications of usability principles, not demographic research proving every user aged 30–40 prefers the same design. [Heuristics for complex applications](https://www.nngroup.com/articles/usability-heuristics-complex-applications/).

Text contrast was another practical check: W3C's normal-text minimum is 4.5:1, with a 3:1 threshold for large text. The redesign uses strong text/background separation and respects reduced motion. This is a design target, not a claim that every accessibility requirement has been audited. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Agents should know what is still missing

Anthropic's workflow guidance argues for starting with the simplest effective system, decomposing tasks and checking intermediate results. Here that means keeping scouting, profiling, judging and contact research separate, retaining their structured evidence, and using a deterministic plan instead of an extra general planning call. [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

Its research-agent account emphasizes scoped objectives, coordinated parallel work and adapting searches to discoveries. Partner Radar uses the custom brief throughout its bounded workflow, shares evidence across stages and follows up on missing people, emails, LinkedIn profiles or current-role evidence. Phone research retains sources and leaves unsupported numbers blank. [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).

The added regression cases check outcomes: whether gaps trigger a targeted pass, independently checked data survives a merge, custom priorities reach scoring, and exports retain source-bearing contact fields. Passing mocked tests does not establish a live-web recall benchmark. [Evaluating AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## Rich contact data with honest provenance

Hunter can supply business-email evidence and professional profile fields; Apollo can enrich an identified professional. Partner Radar applies identity and company checks, preserves independent deliverability results and keeps LinkedIn links specific to the person where available. [Hunter API](https://hunter.io/api-documentation/v2), [Apollo person enrichment](https://docs.apollo.io/reference/people-enrichment).

A public company switchboard and a direct business line are different facts. The workflow and exports label the distinction and retain the phone source URL. Unsupported phone fields stay blank. The app does not initiate Apollo's mobile-number reveal or require a public callback server.

## Practical limits and further opportunities

Results depend on the provider's research tools, public-source coverage and vendor credits. A LinkedIn URL aids discovery but does not prove a current job by itself. A source checked today can still describe an old role, so dates and review warnings matter.

Further options worth evaluating are public legal-entity identity registries, market-specific directories, and a labeled live benchmark over known financial firms. Each needs a defined data contract, an access method and outcome tests before claiming improved coverage.

GLEIF is a specific candidate for the identity layer: its public API supports legal-entity names, addresses, fuzzy matches and parent/child relationships. That could help distinguish similarly named institutions and subsidiaries. It does not establish that a firm is licensed for a particular business or provide an individual's contact data. [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api).
