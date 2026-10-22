# PhishGuard AI

Checks a link for phishing warning signs **without opening it**. React + Vite frontend, FastAPI backend, scikit-learn model, optional Google Safe Browsing / VirusTotal lookups, SQLite history.

## How it works (data flow)

```
Browser (React)  --POST /api/analyze-->  FastAPI
                                          1. validate + normalise URL (never fetched)
                                          2. rule engine  -> explainable indicators
                                          3. ML model     -> score (only if you trained one)
                                          4. threat intel -> only with user consent + API keys + public host
                                          5. combine -> classification, 0-100 score, report
                                          6. save redacted URL + verdict to SQLite
```

Each layer is a separate module: `features.py`, `rules.py`, `ml.py`, `threat_intel.py`, `db.py`, `analyzer.py`.

## Honest status

* **The ML model is NOT included.** No dataset could be downloaded in the build environment, so no model was trained. Until you train one, the API reports `ml.status = "not_trained"` and uses rules (and optional threat intel) only. Nothing is faked.
* Training code, leakage controls and metrics are tested on **synthetic data in `tests/` purely to verify the pipeline runs**. Those numbers mean nothing.
* Domain age/WHOIS is **not** implemented (needs a reliable external source). PhishTank is not integrated (its API access is restricted); the provider interface in `threat_intel.py` makes adding it straightforward.
* Tested here: 49 backend tests + 4 frontend tests pass, the frontend builds, and the API was smoke-tested with curl. Not tested here: real Safe Browsing/VirusTotal calls (mocked in tests), deployment to a live host, a trained model on a real dataset.

## Run locally (Windows PowerShell)

Requirements: Python 3.11+ and Node.js 20+.

```powershell
# 1. Backend
cd backend
py -m venv .venv
# If activation is blocked:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000
```
Open http://127.0.0.1:8000/health — expect `{"status":"ok",...,"model":{"loaded":false,...}}`.

```powershell
# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. In development Vite proxies `/api` to port 8000.

## Train the model

1. Get a labelled URL dataset and read its documentation for the label meaning. Example: the *PhiUSIIL Phishing URL* dataset on the UCI repository (check which label value means phishing; verify, don't assume). Save as `backend/datasets/urls.csv`.
2. Train:
```powershell
cd backend
python -m training.train --data datasets/urls.csv --url-col URL --label-col label --phishing-values 0 --name "PhiUSIIL"
```
`--phishing-values` lists the label values that mean **phishing** (for PhiUSIIL as published, phishing is believed to be `0`; confirm against the dataset page).

What it does: normalises URLs, drops invalid rows, removes duplicates and conflicting labels, extracts lexical features, splits train / validation / test **grouped by registered domain** (no domain appears in two splits), compares RandomForest and HistGradientBoosting on validation F1, evaluates the winner once on the test set (precision, recall, F1, false-positive rate, ROC-AUC, confusion matrix) and saves `models/model.joblib` + `models/metadata.json`. Restart the API; `/health` will show `model.loaded: true`.

Caveats: lexical-only models inherit dataset bias and can be evaded. Scheme and `www.` are excluded from features to avoid dataset artefacts. Scores are not calibrated probabilities. Only load model files you trained yourself (joblib can execute code on load).

## Threat intelligence (optional)

Put keys in `backend/.env` (never in code or the frontend): `GOOGLE_SAFE_BROWSING_API_KEY`, `VIRUSTOTAL_API_KEY`. Check each provider's terms and quotas first. The UI only offers the option when a key exists, and a URL is sent only when the user ticks the consent box **and** the host is public. Private, loopback, link-local and metadata addresses are never sent. A source shows "Checked" only if it returned an answer; failures show as failed / limit reached / not set up.

## Tests

```powershell
cd backend;  python -m pytest -q
cd ..\frontend; npm test
```

## Security notes

* URLs are never fetched, DNS is never resolved, so the server cannot be used for SSRF. Outbound calls go only to fixed provider hosts, with timeouts, redirects off.
* Stored and displayed URLs are redacted: credentials and fragments removed, long path tokens and sensitive/long query values replaced with `[redacted]`. Logs contain only registered domain, verdict and score.
* Input limits: 2048-char URL, 4 KB body, per-IP rate limits (in-memory; use a gateway or Redis behind multiple workers). Strict CORS allow-list, security headers, parameterised SQL, generic 500 errors, no input echoed in errors. React renders all server text as plain text; links are never made clickable.
* History is separated by an anonymous browser-generated id (`X-Client-Id`). It is a convenience, **not authentication**; add real auth before storing anything more.
* Dependencies are pinned in `requirements.txt` / `package-lock.json`; run `pip-audit` and `npm audit` regularly.

## Deploy

* **Backend** (Render, Railway, Fly.io): root `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `APP_ENV=production`, `CORS_ORIGINS=https://your-frontend-domain`, API keys as secrets. SQLite needs a persistent disk, or move `db.py` to PostgreSQL. Commit or upload your trained `models/` files, or train during build. Run behind HTTPS only.
* **Frontend** (Vercel, Netlify, Cloudflare Pages): root `frontend`, build `npm run build`, output `dist`, env `VITE_API_BASE=https://your-backend-domain`.
* After deploying, confirm: `/health` works, CORS allows only your frontend, `/docs` is disabled, rate limiting responds with 429.
