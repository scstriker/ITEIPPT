# Firebase Functions API

This package provides the cloud backend for ITEIPPT on Firebase Functions (Gen2).

## Endpoints

- `GET /api/health`
- `POST /api/plan`
- `POST /api/generate-content`

All endpoints are served by the exported function `api`.

## Runtime

- Node.js 20
- Region: `asia-east1`
- Memory: `512MiB`
- Timeout: `120s`

## Required secret

- `GEMINI_API_KEY`

Set via CLI:

```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

## Optional env vars

- `GEMINI_BASE_URL`
- `GEMINI_PLAN_MODEL`
- `GEMINI_CONTENT_MODEL`
- `ALLOWED_ORIGINS` (comma-separated)

## Build

```powershell
cd functions
npm install
npm run build
```

## Deploy (from repo root)

```powershell
firebase deploy --only functions,hosting
```
