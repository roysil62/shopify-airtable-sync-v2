# Quick Start Guide

## 📦 What's in This Package

A complete, ready-to-deploy Shopify ↔ Airtable sync system with **handle-based matching** to prevent duplicates.

**Files included:**
- ✅ All code files with the `dotenv` fix (no more `dotenvx` errors)
- ✅ Handle-based matching implemented in `sync-from-shopify.js`
- ✅ Your production credentials in `.env.production`
- ✅ Deployment configuration for Render
- ✅ Complete documentation

## 🚀 2-Minute Setup

### Option 1: Deploy to Render (Recommended)

1. **Extract this archive** to your computer
2. **Open GitHub Desktop**
3. Create new repo: `File` → `New Repository`
   - Name: `shopify-airtable-sync-v2`
   - Make it **Private**
4. **Copy all files** from extracted folder into the new repo
5. **Commit and publish** in GitHub Desktop
6. Go to [Render Dashboard](https://dashboard.render.com/)
7. Click **New** → **Blueprint**
8. Select your new GitHub repo
9. Set environment variables for each service (see `DEPLOY.md`)

**That's it!** See `DEPLOY.md` for detailed instructions.

### Option 2: Test Locally First

```bash
# Extract the archive
tar -xzf shopify-airtable-sync-v2.tar.gz
cd shopify-airtable-sync-v2

# Install dependencies
npm install

# Test Shopify → Airtable sync
node sync-prod.js

# Should see:
# ✅ Got access token
# ✅ Fetched X products from Shopify
# ✅ Updated: Product - Variant (Handle: product-handle)
```

## ✅ What's Fixed in v2.0

1. **sync-prod.js** - Now uses `dotenv` instead of `dotenvx` ✅
2. **Handle-based matching** - Prevents duplicates when publishing variants separately ✅
3. **3-layer matching system:**
   - Priority 1: Variant ID
   - Priority 2: Handle + Variant Title ⭐ **NEW**
   - Priority 3: SKU

## 📋 Files Overview

| File | Purpose |
|------|---------|
| `index.js` | Airtable → Shopify sync (publishes items) |
| `sync-from-shopify.js` | Shopify → Airtable sync with handle matching |
| `sync-prod.js` | Production runner (FIXED - uses dotenv) |
| `package.json` | Dependencies |
| `render.yaml` | Render deployment config (3 cron jobs) |
| `.env.production` | Your credentials (included) |
| `.env.example` | Template for other businesses |
| `.gitignore` | Prevents committing sensitive files |
| `README.md` | Full documentation |
| `DEPLOY.md` | Step-by-step deployment guide |

## 🔐 Your Credentials (Already Configured)

These are already in `.env.production`:

```
✅ AIRTABLE_API_KEY (set)
✅ AIRTABLE_BASE_ID (set)
✅ AIRTABLE_TABLE_NAME (set)
✅ CLIENT_ID (set)
✅ CLIENT_SECRET (set)
✅ SHOPIFY_DOMAIN (set)
```

## 📖 Documentation

- **README.md** - Overview, features, troubleshooting
- **DEPLOY.md** - Complete Render deployment guide
- **This file** - Quick start

## ⏰ Automated Schedule (When Deployed)

- **Airtable → Shopify:** Every 15 minutes
- **Shopify → Airtable:** 10am & 7pm ET daily

## 💰 Cost

- $21/month total on Render (3 services × $7/month each)

## 🎯 Next Steps

1. **Read DEPLOY.md** for complete deployment instructions
2. **Test locally** (optional but recommended)
3. **Deploy to Render** using the blueprint
4. **Monitor logs** to verify handle-based matching is working

## 🆘 Need Help?

Check the logs in Render for any errors. The key success indicator is:

```
✅ Updated: Product Name - Variant (Handle: product-handle)
                                     ^^^^^^^^^^^^^^^^^^^^^^^^
```

If you see `(Handle: ...)` in the logs, the new code is working! ✅

---

**You can now keep your old setup running** and test this new version separately. Once you confirm it works, you can delete the old Render services.
