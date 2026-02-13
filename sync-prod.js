require('dotenv').config({ path: '.env.production' });
const { syncFromShopify } = require('./sync-from-shopify');

// Check for required environment variables
const requiredVars = [
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
    'AIRTABLE_TABLE_NAME',
    'CLIENT_ID',
    'CLIENT_SECRET',
    'SHOPIFY_DOMAIN'
];

const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing environment variables');
    console.error('Missing:', missingVars.join(', '));
    process.exit(1);
}

console.log('⚡ Starting sync from Shopify to Airtable...');

// Run the sync
syncFromShopify();
