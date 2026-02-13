const Airtable = require('airtable');

// Get OAuth access token
async function getAccessToken() {
    const tokenUrl = `https://${process.env.SHOPIFY_DOMAIN}/admin/oauth/access_token`;
    
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'client_credentials'
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get access token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Got access token');
    return data.access_token;
}

// Fetch all products from Shopify
async function fetchAllProducts(accessToken) {
    let allProducts = [];
    let url = `https://${process.env.SHOPIFY_DOMAIN}/admin/api/2024-10/products.json?limit=250`;
    
    while (url) {
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch products: ${response.status}`);
        }

        const data = await response.json();
        allProducts = allProducts.concat(data.products);
        
        // Check for pagination link in response headers
        const linkHeader = response.headers.get('link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
            // Extract next page URL from Link header
            const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            url = nextMatch ? nextMatch[1] : null;
        } else {
            url = null; // No more pages
        }
        
        console.log(`📥 Fetched ${allProducts.length} products so far...`);
    }
    
    console.log(`✅ Fetched ${allProducts.length} total products from Shopify`);
    return allProducts;
}

// Update Airtable with Shopify data
async function updateAirtable(products) {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
    const table = base(process.env.AIRTABLE_TABLE_NAME);

    console.log(`📊 Processing ${products.length} products...\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const negativeInventory = [];

    for (const product of products) {
        for (const variant of product.variants) {
            try {
                // PRIORITY 1: Try to find existing record by Shopify Product ID
                let records = await table.select({
                    filterByFormula: `{Shopify Product ID} = "${product.id}"`
                }).firstPage();

                // PRIORITY 2: If not found, try by Handle only
                if (records.length === 0 && product.handle) {
                    const escapedHandle = product.handle.replace(/"/g, '\\"');
                    records = await table.select({
                        filterByFormula: `{Handle} = "${escapedHandle}"`
                    }).firstPage();
                }

                // PRIORITY 3: If still not found, try by SKU
                if (records.length === 0 && variant.sku) {
                    const escapedSku = variant.sku.replace(/"/g, '\\"');
                    records = await table.select({
                        filterByFormula: `{SKU} = "${escapedSku}"`
                    }).firstPage();
                }

                const inventory = variant.inventory_quantity || 0;
                const fields = {
                    'Variant ID': variant.id.toString(),
                    'Shopify Product ID': product.id.toString(),
                    'Shopify Product URL': `https://${process.env.SHOPIFY_DOMAIN}/admin/products/${product.id}`,
                    'Shopify Inventory': inventory,
                    'Date Created on Shopify': product.created_at ? product.created_at.split('T')[0] : ''
                };

                if (records.length > 0) {
                    await table.update(records[0].id, fields);
                    updatedCount++;
                } else {
                    skippedCount++;
                }

                // Track negative inventory
                if (inventory < 0) {
                    negativeInventory.push({
                        title: product.title,
                        variant: variant.title,
                        sku: variant.sku || 'N/A',
                        inventory: inventory
                    });
                }

            } catch (error) {
                console.error(`❌ Error processing ${product.title} - ${variant.title}:`, error.message);
                errorCount++;
            }
        }
    }

    console.log(`${'='.repeat(50)}`);
    console.log(`✨ SYNC COMPLETE`);
    console.log(`${'='.repeat(50)}`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped (not in Airtable): ${skippedCount}`);
    if (errorCount > 0) {
        console.log(`   ❌ Errors: ${errorCount}`);
    }

    if (negativeInventory.length > 0) {
        console.log(`\n⚠️  NEGATIVE INVENTORY (${negativeInventory.length} items):`);
        for (const item of negativeInventory) {
            console.log(`   🔴 ${item.title} - ${item.variant} (SKU: ${item.sku}) → ${item.inventory}`);
        }
    } else {
        console.log(`\n   ✅ No negative inventory found`);
    }
    console.log(`${'='.repeat(50)}\n`);
}

// Main sync function
async function syncFromShopify() {
    try {
        const accessToken = await getAccessToken();
        const products = await fetchAllProducts(accessToken);
        await updateAirtable(products);
    } catch (error) {
        console.error('❌ Sync failed:', error);
        process.exit(1);
    }
}

module.exports = { syncFromShopify };
