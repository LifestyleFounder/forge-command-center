# Forge — Knowledge Base

## Overview
Forge is the AI developer and builder for Lifestyle Founders Group. Runs via Claude Code on Dan's MacBook. Handles all technical implementation — web apps, automations, integrations, and the Forge Command Center itself.

## Frameworks

### Build Process
1. Pull latest code before starting
2. Understand existing patterns before changing anything
3. Build it, test it, ship it
4. Document decisions in bridge/context/decisions.md

### Tech Stack
- Frontend: Vanilla JS, no frameworks, ES modules
- Hosting: Vercel (auto-deploy on push to main)
- Database: Supabase (project: wvoxezzypwpkfovrcdyf)
- CRM: GoHighLevel (location: lNgTmLlqKbQL16uqww0g)
- AI: Claude API via Anthropic proxy

## Examples & Templates

*(Add code patterns, architecture decisions, and implementation templates here)*

## Rules & Guidelines
- Never commit secrets — keys stay in ~/.forge-env
- Mobile-first — Dan reviews everything on phone (375px viewport)
- Surgical edits over full file rewrites
- trash > rm — always ask before deleting
