# Study Desk

A personal dashboard for planning study tasks, tracking focused time, recording offline study, and reflecting on each day.

## Live dashboard

Open [Study Desk on GitHub Pages](https://xinie92.github.io/study-progress-dashboard-sign-in/).

## How the app is organized

- `index.html`, `styles.css`, and `app.js` make up the dashboard shown in the browser.
- GitHub Pages serves these files at the website address above. The public GitHub repository contains the app code.
- Supabase provides sign-in and the online database. Study records are saved in Supabase, not in the GitHub repository.
- `cloud-config.js` contains the Supabase project URL and publishable key used by the browser app. Publishable keys are intended for browser use. Never put a database password, secret key, or service-role key in this file.

## Where study data is stored

The Supabase table is `public.study_data`. It has **one row per signed-in account**, identified by `user_id`. That row's `data` field contains the account's courses, sessions, plans, reflections, and weekly tasks as JSON. Row-level security allows an account to access only its own row. The SQL that creates the table and those rules is in [`supabase/schema.sql`](supabase/schema.sql).

Signing into the same account on another device uses the same row; it does not add a row for each device or each sign-in. When you change or add study information, the app updates the row's `data`. The `updated_at` field records the latest database write. The app checks for updates from another open device about every 20 seconds.

### Checking whether an update synced

1. Save or add something in the dashboard while signed in.
2. In Supabase, open **Table Editor → `study_data`** and refresh the table.
3. Open the row's `data` field to see the saved dashboard information. Check `updated_at` for the latest write time.

Signing in by itself does not create a separate data row. If no study information has changed, the row count can stay at one.

## Sign-in setup

The GitHub Pages URL should be set as the Supabase Auth **Site URL**, and added to the allowed **Redirect URLs**:

`https://xinie92.github.io/study-progress-dashboard-sign-in/`

Use the same Study Desk account on each device. Existing data kept only in a browser can be exported from that browser and imported into Study Desk after signing in.
