# AutoTrace

AutoTrace is an automotive research workspace for exploring public NHTSA complaints, recurring narrative themes, model-year report patterns, recalls, and investigations. The browser app starts in a clearly marked sample-data mode; sample values are illustrative and are not NHTSA findings.

> **Interpretation:** Complaint reports are voluntary and self-selected. Counts and trends describe reports received, not vehicle failure rates, defect prevalence, or the reliability of an individual vehicle.

## Stack

- React 19, Vite, Tailwind CSS, and Recharts
- Supabase Auth, PostgreSQL, and Edge Functions
- Python, Pandas, scikit-learn, and the public NHTSA API

## Run the frontend

```powershell
npm install
Copy-Item .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env to enable live services.
npm run dev
```

Without Supabase browser credentials, AutoTrace runs in demonstration mode and labels its data as illustrative. The live search, email-link sign-in, and persistent saved searches require a configured Supabase project.

## Configure Supabase

1. Create a Supabase project and apply `supabase/migrations/202611110001_initial_schema.sql` in the SQL editor.
   The migration creates the schema and common BMW trim aliases. Live vehicle searches fetch complaint and recall data from NHTSA on demand; importing vehicle records first is not required.
2. In the Supabase dashboard, copy the project's **publishable key** (the `sb_publishable_...` key) and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the frontend environment.
3. Deploy the NHTSA research function:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy vehicle-research
   ```

4. Enable email OTP in Supabase Auth. Saved searches are scoped to the signed-in user by row-level security.

The function accepts a make/model and a model-year range of up to 16 years, and fetches complaint and recall records directly from NHTSA; it does not require the importer or a Supabase secret key. Choose a start year and optionally an end year (leaving it blank searches only the start year). Year, make, and model are selected from dropdowns populated by NHTSA's vPIC vehicle catalog. NHTSA may return HTTP 400 for a vehicle with no matching records; the function treats that as empty only when the response explicitly reports zero results. It also resolves common misspellings and maps common BMW trims (for example, 330i) to the broader NHTSA model family (3 Series). Live results use NHTSA's model label to avoid implying trim-level precision. Investigations are not included in live results.

## Import public NHTSA data

Importing is optional for live searches. The script can still preload data for database-based research and analysis. Use model labels recognized by NHTSA (for example, `3 SERIES`) when ingesting. It creates normalized vehicle rows, upserts complaint and recall records, groups complaint narratives with TF-IDF and K-means, and flags unusual yearly report volumes with Isolation Forest when enough model years are available.
NHTSA's recall endpoint can respond with HTTP 400 for a successful empty result; the importer recognizes that exact empty-result response and continues with zero recalls for that vehicle year. Other HTTP errors still fail the import.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SECRET_KEY = "your-secret-key"
python pipeline\ingest_nhtsa.py --make BMW --model "3 SERIES" --start-year 2017 --end-year 2024
```

Use the secret key only in a trusted worker or server environment. Re-running an import is safe: complaint and recall rows are upserted by their source identifiers. Data is fetched from NHTSA at runtime; this repository does not include a copied NHTSA dataset.

### Schedule imports with GitHub Actions

Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as repository Actions secrets. The included workflow runs weekly for BMW 3 Series model years 2017–2024 and can also be started manually with a different make, NHTSA model label, and year range. The worker currently imports complaints and recalls; investigation records have a schema and UI surface but are not fabricated or automatically ingested.

## Deploy

- Deploy the frontend to Vercel and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the project environment.
- Deploy the database and Edge Function to Supabase.
- Run the Python importer from a trusted scheduled worker to refresh the public records. Do not put its secret key in the browser or a client-side Vercel variable.

> **Key migration:** Supabase still accepts legacy anon and service-role keys, but marks them deprecated. Create/copy the new publishable and secret keys from the Supabase dashboard and use those values here. They are different keys: renaming an old key's environment variable does not convert it.

## Validate

```powershell
npm run lint
npm run build
python -m py_compile pipeline\ingest_nhtsa.py
```

The dashboard's export action downloads a CSV research summary. Recall campaigns, investigations, and complaint submissions are separate records and should be interpreted independently.
