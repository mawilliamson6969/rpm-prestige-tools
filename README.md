# rpm-prestige-tools
Internal Tools for RPM Prestige

## Credentials

Never commit real credentials. `.env.example` documents required variables; populate `.env` from a secrets vault on the server only. This applies to all `APPFOLIO_*`, `BOOM_*`, `LEADSIMPLE_*`, `MICROSOFT_*`, `ANTHROPIC_*`, `OPENAI_*`, `LETTERSTREAM_*`, `DOCUSEAL_*`, and `JWT_SECRET` values.

## Tests

Backend unit tests use Node's built-in test runner (no extra dep):

```
cd backend && npm test
```
