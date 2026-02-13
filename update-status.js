// Update product STATUS in Shopify based on Airtable changes
// Trigger: Shopify Status = "Archived" or "Draft"

require('dotenv').config({ override: true });
const Airtable = require('airtable');

const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
  CLIENT_ID,
  CLIENT_SECRET,
  SHOPIFY_DOMAIN
} = process.env;

if (
  !AIRTABLE_API_KEY ||
  !AIRTABLE_BASE_ID ||
  !AIRTABLE_TABLE_NAME ||
  !CLIENT_ID ||
  !CLIENT_SECRET ||
  !SHOPIFY_DOMAIN
) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

// Get access token
async function getAccessToken() {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      }
    );
    
    const data = await response.json();
    
    if (data.access_token) {
      console.log('✅ Got access token');
      return data.access_token;
    } else {
      throw new Error(JSON.stringify(data));
    }
  } catch (error) {
    console.error('❌ Error getting access token:', error);
    process.exit(1);
  }
}

// Update product status in Shopify
async function updateProductStatus(accessToken, productId, newStatus) {
  try {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products/${productId}.json`;
    
    const payload = {
      product: {
        id: productId,
        status: newStatus // "active", "draft", or "archived"
      }
    };

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok && data.product) {
      return { success: true, product: data.product };
    } else {
      return { success: false, error: JSON.stringify(data.errors || data) };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Update Airtable record status after sync
async function updateAirtableStatus(base, recordId, status, errorMessage = null) {
  try {
    const updates = {
      'Last Synced': new Date().toISOString().split('T')[0]
    };
    
    if (errorMessage) {
      updates['Sync Error Message'] = errorMessage;
    } else {
      updates['Sync Error Message'] = ''; // Clear error message on success
    }
    
    await base(AIRTABLE_TABLE_NAME).update(recordId, updates);
    return true;
  } catch (error) {
    console.error(`   ⚠️  Failed to update Airtable record ${recordId}:`, error.message);
    return false;
  }
}

// Main sync function
async function syncStatusChanges() {
  try {
    console.log('🔄 Starting status update sync...\n');

    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
    const table = base(AIRTABLE_TABLE_NAME);

    const accessToken = await getAccessToken();

    // Find records with Shopify Status = "Archived" or "Draft"
    const records = await table.select({
      filterByFormula: `OR({Shopify Status} = "Archived", {Shopify Status} = "Draft")`
    }).all();

    console.log(`📦 Found ${records.length} records to update\n`);

    if (records.length === 0) {
      console.log('✅ No status changes to sync');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      const productName = record.get('Name');
      const shopifyProductId = record.get('Shopify Product ID');
      const desiredStatus = record.get('Shopify Status');

      if (!shopifyProductId) {
        console.log(`⏭️  Skipped: ${productName} - No Shopify Product ID found`);
        skippedCount++;
        continue;
      }

      // Map Airtable status to Shopify status
      let shopifyStatus = 'active';
      if (desiredStatus === 'Archived') {
        shopifyStatus = 'archived';
      } else if (desiredStatus === 'Draft') {
        shopifyStatus = 'draft';
      }

      console.log(`🔄 Updating: ${productName}`);
      console.log(`   Product ID: ${shopifyProductId}`);
      console.log(`   New Status: ${shopifyStatus}`);

      const result = await updateProductStatus(accessToken, shopifyProductId, shopifyStatus);

      if (result.success) {
        console.log(`   ✅ Updated successfully\n`);
        await updateAirtableStatus(base, record.id, desiredStatus);
        successCount++;
      } else {
        console.log(`   ❌ Failed: ${result.error}\n`);
        await updateAirtableStatus(base, record.id, desiredStatus, result.error);
        errorCount++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✨ SYNC COMPLETE`);
    console.log(`${'='.repeat(50)}`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Successfully updated: ${successCount}`);
    console.log(`   ⏭️  Skipped (no Product ID): ${skippedCount}`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount}`);
    }
    console.log(`${'='.repeat(50)}\n`);

  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  }
}

syncStatusChanges();
