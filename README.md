# Study Desk cloud sync setup

There is no online database connected yet. The dashboard can still run locally; cloud sign-in becomes available after you connect a Supabase project and serve the page from a web address.

## Create the database

1. Create a Supabase account and a new project.
2. In the project dashboard, open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates one private data record per signed-in account. Row-level security prevents one account from reading another account's record.
3. In the project settings, find the **Project URL** and **Publishable key**. Put them in [`cloud-config.js`](cloud-config.js):

   ```js
   window.STUDY_DESK_CONFIG = {
     supabaseUrl: "https://your-project.supabase.co",
     supabasePublishableKey: "your-publishable-key"
   };
   ```

   The publishable key is intended for browser use. Never put a database password, secret key, or service-role key in this file.

## Publish and use it

The app needs an HTTPS website address for account confirmation links and iPad access. GitHub Pages can serve the page files, but it does not store study entries. Configure the Supabase Auth site's URL and allowed redirect URLs to match the published address. Then open the site, choose **Create account**, and use the same email and password on each device.

When you first sign in, this app merges the browser's existing data with your cloud data. Use **Export** first as a backup. If the old dashboard was opened as a local file, import its backup after opening the published site and signing in.

The app saves updates to Supabase and checks for changes from another device about every 20 seconds while open.
