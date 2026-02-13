# Shopify ↔ Airtable Sync System v2.0

Automated bidirectional sync between Shopify and Airtable with **handle-based matching** to prevent duplicate products.

## 🎯 What This Does

### Airtable → Shopify (Every 15 minutes)
- Finds records with "Publish" status in Airtable
- Creates new products in Shopify
- Updates status to "Live" when successful

### Shopify → Airtable (2x daily: 10am & 7pm ET)
- Fetches all products from Shopify
- Updates Airtable with current inventory, prices, and product info
- **Uses 3-layer matching to prevent duplicates:**
  1. Match by Variant ID (exact match)
  2. Match by Handle + Variant Title ⭐ **KEY FIX**
  3. Match by SKU (fallback)

## 🔑 Key Features

### Handle-Based Matching
When you publish variants separately in Shopify (e.g., first publish "Red - Small", then add "Red - Large" later), the system will:
- ✅ Update the existing Airtable record instead of creating a duplicate
- ✅ Group variants by their product handle
- ✅ Maintain data integrity across syncs

### Why This Matters
Without handle-based matching, publishing 3 variants separately would create 3 duplicate product records in Airtable. With this fix, they all update the same record.

## 📁 File Structure

```
shopify-airtable-sync-v2/
├── index.js                 # Airtable → Shopify sync
├── sync-from-shopify.js     # Shopify → Airtable sync (with handle matching)
├── sync-prod.js             # Production runner script
├── package.json             # Dependencies
├── render.yaml              # Render deployment config
├── .env.example             # Template for environment variables
├── .env.production          # Your actual credentials (DON'T commit!)
└── .gitignore               # Prevents committing sensitive files
```

## 🚀 Quick Start

### 1. Local Testing

```bash
# Install dependencies
npm install

# Copy your credentials
cp .env.example .env.production
# Edit .env.production with your actual credentials

# Test Shopify → Airtable sync
node sync-prod.js

# Test Airtable → Shopify sync
node index.js
```

### 2. Deploy to Render

See `DEPLOY.md` for detailed deployment instructions.

## 🔐 Required Environment Variables

All 6 variables are required:

```
AIRTABLE_API_KEY=patXXXXXXXXXXXXXXX
AIRTABLE_BASE_ID=appXXXXXXXXXXX
AIRTABLE_TABLE_NAME=Shopify Items (Inventory)
CLIENT_ID=XXXXXXXXXXXXXXXX
CLIENT_SECRET=shpss_XXXXXXXXXXXXXXXX
SHOPIFY_DOMAIN=your-store.myshopify.com
```

## 📊 Airtable Table Requirements

Your Airtable table must have these fields:
- `Product Title` (Text)
- `Variant Title` (Text)
- `SKU` (Text)
- `Price` (Number)
- `Inventory` (Number)
- `Variant ID` (Text)
- `Product ID` (Text)
- `Handle` (Text) ⭐ **Required for handle-based matching**
- `Image URL` (Text)
- `Status` (Single Select: "Publish", "Live", etc.)

## ⏰ Sync Schedule (Render Deployment)

- **Airtable → Shopify:** Every 15 minutes (`*/15 * * * *`)
- **Shopify → Airtable (Morning):** 10:00 AM ET daily
- **Shopify → Airtable (Evening):** 7:00 PM ET daily

## 🛠️ Troubleshooting

### "Cannot find module 'dotenv'"
```bash
npm install
```

### "Missing environment variables"
Check that all 6 variables are set in `.env.production` or Render environment variables.

### "Error getting access token"
Verify your `CLIENT_ID`, `CLIENT_SECRET`, and `SHOPIFY_DOMAIN` are correct.

### Duplicates still appearing
Make sure your Airtable table has a `Handle` field and the new code is deployed.

## 📝 Version History

**v2.0 (February 2026)**
- ✅ Fixed sync-prod.js to use `dotenv` instead of `dotenvx`
- ✅ Implemented handle-based matching to prevent duplicates
- ✅ 3-layer priority matching system
- ✅ Complete deployment package

**v1.0 (Initial version)**
- Basic Shopify ↔ Airtable sync
- Variant ID and SKU matching only

## 📄 License

MIT

## 💡 Support

For issues or questions, check the logs:
- **Local:** Terminal output when running `node sync-prod.js`
- **Render:** Click service → "Logs" tab

Look for:
- `✅ Updated: Product Name - Variant (Handle: product-handle)` = Working correctly
- `❌ Error processing...` = Check credentials or Airtable schema
