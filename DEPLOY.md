# Deployment Guide - Render

## Prerequisites

- GitHub account
- Render account (free or paid)
- Your credentials ready (6 environment variables)

## Step 1: Create New GitHub Repository

### Option A: Using GitHub Desktop (Recommended)

1. Open GitHub Desktop
2. Click **File** → **New Repository**
3. Settings:
   - **Name:** `shopify-airtable-sync-v2`
   - **Local Path:** Choose where to save it
   - ✅ Check "Initialize with README"
   - Click **Create Repository**

4. Copy all files from this package into the new repo folder:
   - `index.js`
   - `sync-from-shopify.js`
   - `sync-prod.js`
   - `package.json`
   - `render.yaml`
   - `.gitignore`
   - `README.md`
   - **DON'T copy `.env.production`** (it's in .gitignore)

5. In GitHub Desktop:
   - Check all the files
   - Write commit message: "Initial commit - v2.0 with handle-based matching"
   - Click **Commit to main**
   - Click **Publish repository**
   - Choose **Private repository** ✅
   - Click **Publish Repository**

### Option B: Using Terminal

```bash
# Navigate to the package folder
cd /path/to/shopify-airtable-sync-v2

# Initialize git
git init

# Add all files (except .env.production thanks to .gitignore)
git add .

# Commit
git commit -m "Initial commit - v2.0 with handle-based matching"

# Create repo on GitHub and push
# (Follow GitHub's instructions for creating a new repo)
```

## Step 2: Deploy to Render Using Blueprint

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **Blueprint**
3. Connect your GitHub account (if not already connected)
4. Select the repository: `shopify-airtable-sync-v2`
5. Click **Apply**

Render will detect the `render.yaml` file and create 3 cron jobs:
- `airtable-to-shopify-sync` (every 15 min)
- `shopify-sync-morning` (10am ET daily)
- `shopify-sync-evening` (7pm ET daily)

## Step 3: Set Environment Variables

**You need to set the same 6 variables for EACH of the 3 services:**

For each service:

1. Click on the service name
2. Go to **Environment** (left sidebar)
3. Click **Add Environment Variable**
4. Add all 6 variables:

```
AIRTABLE_API_KEY = your_airtable_personal_access_token
AIRTABLE_BASE_ID = your_airtable_base_id
AIRTABLE_TABLE_NAME = your_airtable_table_name
CLIENT_ID = your_shopify_client_id
CLIENT_SECRET = your_shopify_client_secret
SHOPIFY_DOMAIN = your-store.myshopify.com
```

5. Click **Save Changes**
6. The service will automatically redeploy with the new variables

**Repeat for all 3 services!**

## Step 4: Manual Deploy (if needed)

If the services don't auto-deploy after adding environment variables:

1. Click on the service
2. Click **Manual Deploy** → **Deploy latest commit**
3. Wait for deployment to complete (watch the logs)

## Step 5: Verify Deployment

### Check Logs

For each service:
1. Click on the service
2. Click **Logs** tab
3. Look for successful execution:

**For Airtable → Shopify sync:**
```
🚀 Starting Airtable → Shopify sync...
📦 Found X items to publish
✅ Published: Product Name
✅ Sync complete!
```

**For Shopify → Airtable sync:**
```
⚡ Starting sync from Shopify to Airtable...
✅ Got access token
✅ Fetched X products from Shopify
📊 Processing X products...
✅ Updated: Product Name - Variant (Handle: product-handle)
✅ Sync complete!
```

### Verify Handle-Based Matching

The key indicator that the new code is working:
```
✅ Updated: Product Name - Variant (Handle: product-handle)
                                     ^^^^^^^^^^^^^^^^^^^^^^^^
                                     This shows handle matching is working!
```

## Step 6: Test with Real Data

1. In Shopify: Create a product with 1 variant
2. Wait for morning or evening sync (or trigger manually in Render)
3. Check Airtable - should see 1 record created
4. In Shopify: Add a 2nd variant to the SAME product
5. Wait for next sync
6. Check Airtable - should **UPDATE** existing record, not create duplicate ✅

## Troubleshooting

### Services show "Failed" status
- Check the **Logs** tab for error messages
- Verify all 6 environment variables are set correctly
- Make sure Airtable table has the `Handle` field

### "Cannot find module" errors
- The service needs to run `npm install` during build
- Check that `render.yaml` has `buildCommand: npm install`

### Old code still running
- Go to service → **Manual Deploy** → **Clear build cache & deploy**

### Time zone issues
- Render uses UTC time
- 10am ET = 3pm UTC (winter) or 2pm UTC (summer)
- 7pm ET = 12am UTC next day (winter) or 11pm UTC (summer)

## Cost Breakdown

Each cron job requires a **Starter plan** ($7/month):
- `airtable-to-shopify-sync`: $7/month
- `shopify-sync-morning`: $7/month
- `shopify-sync-evening`: $7/month

**Total: $21/month**

## Updating Code Later

When you make changes to the code:

1. Edit files locally
2. Commit and push to GitHub (using GitHub Desktop or terminal)
3. In Render: Click service → **Manual Deploy** → **Deploy latest commit**
4. Repeat for all 3 services

## Alternative: Manual Deployment (Without Blueprint)

If you prefer to create services manually instead of using the blueprint:

1. Click **New** → **Cron Job**
2. Connect your repo
3. Settings for first service:
   - **Name:** `airtable-to-shopify-sync`
   - **Branch:** `main`
   - **Schedule:** `*/15 * * * *`
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
4. Add the 6 environment variables
5. Click **Create Cron Job**
6. Repeat for the other 2 services with their respective schedules and commands

## Success Criteria

✅ All 3 services show green "Live" status
✅ Logs show successful syncs
✅ Logs display `(Handle: product-handle)` in output
✅ No duplicate products when publishing variants separately
✅ Airtable updates correctly with Shopify data

---

**You're done!** The system is now running automatically on Render.
