require('dotenv').config();
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
    return data.access_token;
}

// Create product in Shopify
async function createShopifyProduct(accessToken, record) {
    const url = `https://${process.env.SHOPIFY_DOMAIN}/admin/api/2024-10/products.json`;
    
    const productData = {
        product: {
            title: record.get('Name'),
            body_html: record.get('Description') || '',
            vendor: record.get('Brand') || 'COLBO',
            product_type: record.get('Product Type') || '',
            variants: [{
                title: record.get('Size') || 'Default',
                price: record.get('Price') || '0.00',
                sku: record.get('SKU') || '',
                inventory_quantity: record.get('Shopify Inventory') || 0
            }]
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(productData)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create product: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.product;
}

// Update Airtable record with Shopify IDs
async function updateAirtableRecord(table, recordId, productId, variantId) {
    await table.update(recordId, {
        'Shopify Product ID': productId.toString(),
        'Variant ID': variantId.toString(),
        'Status': 'Live/Active'
    });
}

// Main function
async function syncToShopify() {
    try {
        console.log('🚀 Starting Airtable → Shopify sync...');

        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
        const table = base(process.env.AIRTABLE_TABLE_NAME);

        // Find records with "Publish" status
        const records = await table.select({
            filterByFormula: `{Status} = "Publish"`
        }).all();

        console.log(`📦 Found ${records.length} items to publish`);

        if (records.length === 0) {
            console.log('✅ No items to publish');
            return;
        }

        const accessToken = await getAccessToken();

        for (const record of records) {
            try {
                const product = await createShopifyProduct(accessToken, record);
                await updateAirtableRecord(
                    table,
                    record.id,
                    product.id,
                    product.variants[0].id
                );
                console.log(`✅ Published: ${record.get('Name')}`);
            } catch (error) {
                console.error(`❌ Failed to publish ${record.get('Name')}:`, error.message);
            }
        }

        console.log('✅ Sync complete!');
    } catch (error) {
        console.error('❌ Sync failed:', error);
        process.exit(1);
    }
}

syncToShopify();
