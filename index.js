// Upload NEW products from Airtable TO Shopify
// Trigger: Shopify Status = "Publish"
// After upload: Changes status to "Live/Active" or "Error"

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
      console.log(`⏰ Token expires in ${data.expires_in} seconds (24 hours)\n`);
      return data.access_token;
    } else {
      throw new Error(JSON.stringify(data));
    }
  } catch (error) {
    console.error('❌ Error getting access token:', error);
    process.exit(1);
  }
}

// Extract base SKU (remove size suffix like -S, -M, -L, -XL, -XXL, etc.)
function getBaseSKU(sku) {
  if (!sku) return '';
  
  // Common size suffixes to remove
  const sizeSuffixes = ['-XXL', '-XL', '-L', '-M', '-S', '-XXXL', '-XXXXL'];
  
  let baseSKU = sku;
  for (const suffix of sizeSuffixes) {
    if (sku.toUpperCase().endsWith(suffix)) {
      baseSKU = sku.slice(0, -suffix.length);
      break;
    }
  }
  
  return baseSKU;
}

// Find product by base SKU pattern (checks if any variant has matching base)
async function findProductByBaseSKU(baseSKU, accessToken) {
  try {
    // Search for products with variants matching the base SKU pattern
    const query = `
      query {
        productVariants(first: 10, query: "sku:${baseSKU}*") {
          edges {
            node {
              id
              sku
              product {
                id
                title
                handle
                variants(first: 50) {
                  edges {
                    node {
                      id
                      sku
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();
    
    if (data.data && data.data.productVariants.edges.length > 0) {
      // Check if any product has a variant with matching base SKU
      for (const edge of data.data.productVariants.edges) {
        const product = edge.node.product;
        const variantSKUs = product.variants.edges.map(v => v.node.sku);
        
        // Check if any variant has the same base SKU
        for (const varSKU of variantSKUs) {
          if (getBaseSKU(varSKU) === baseSKU) {
            return {
              exists: true,
              product: {
                id: product.id.split('/').pop(),
                title: product.title,
                handle: product.handle,
                variants: product.variants.edges.map(v => ({
                  id: v.node.id.split('/').pop(),
                  sku: v.node.sku
                }))
              }
            };
          }
        }
      }
    }
    
    return { exists: false };
  } catch (error) {
    console.error(`Error finding product by base SKU ${baseSKU}:`, error.message);
    return { exists: false };
  }
}

// Check if product with Handle already exists in Shopify
async function productExistsByHandle(handle, accessToken) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?handle=${handle}`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    
    if (data.products && data.products.length > 0) {
      return {
        exists: true,
        product: data.products[0]
      };
    }
    
    return { exists: false };
  } catch (error) {
    console.error(`Error checking handle ${handle}:`, error.message);
    return { exists: false };
  }
}

// Add variant to existing product
async function addVariantToProduct(accessToken, productId, variant) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products/${productId}/variants.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ variant })
      }
    );

    const data = await response.json();

    if (response.ok && data.variant) {
      return { success: true, variant: data.variant };
    } else {
      return { success: false, error: JSON.stringify(data.errors || data) };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Check if product with SKU already exists in Shopify
async function productExistsBySKU(sku, accessToken) {
  try {
    const query = `
      query {
        productVariants(first: 1, query: "sku:${sku}") {
          edges {
            node {
              id
              sku
              product {
                id
                title
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();
    
    if (data.data && data.data.productVariants.edges.length > 0) {
      const existingProduct = data.data.productVariants.edges[0].node;
      return {
        exists: true,
        productTitle: existingProduct.product.title,
        productId: existingProduct.product.id.split('/').pop()
      };
    }
    
    return { exists: false };
  } catch (error) {
    console.error(`Error checking SKU ${sku}:`, error.message);
    return { exists: false };
  }
}

// Group records by Handle
function groupByHandle(records) {
  const grouped = {};
  
  records.forEach(record => {
    const handle = record.get('Handle');
    const shopifyStatus = record.get('Shopify Status');
    
    // Only process records with "Publish" status
    if (!handle || shopifyStatus !== 'Publish') return;
    
    if (!grouped[handle]) {
      const toString = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
          // For arrays, join all values or return first non-empty value
          const filtered = value.filter(v => v && typeof v === 'string');
          if (filtered.length > 0) {
            return filtered[0]; // Return first valid string value
          }
          return '';
        }
        return String(value);
      };
      
      // Convert to Title Case (proper case)
      const toTitleCase = (str) => {
        if (!str) return '';
        return str.toLowerCase()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      };
      
      // Get vendor from Brand field and convert to proper case
      const brandValue = record.get('Brand') || '';
      const vendor = toTitleCase(brandValue);
      
      // Get sales channels from Airtable
      let salesChannels = record.get('Sales Channel');
      let publishToPos = true; // default to POS
      let publishToOnline = false;
      
      if (salesChannels && Array.isArray(salesChannels)) {
        const channelSet = new Set(salesChannels.map(c => c.toLowerCase()));
        publishToPos = channelSet.has('point of sale (store pos)');
        publishToOnline = channelSet.has('shopify website');
      }
      
      grouped[handle] = {
        handle: handle,
        title: record.get('Name') || '',
        product_type: toString(record.get('Product Type')),
        vendor: vendor,
        tags: toString(record.get('Tags')),
        body_html: toString(record.get('Description')),
        status: 'active',
        published: false, // Create unpublished, then publish to specific channels
        publishToPos: publishToPos,
        publishToOnline: publishToOnline,
        variants: [],
        recordIds: [] // Track all Airtable record IDs for this product
      };
    }
    
    // Add variant
    const variant = {
      sku: record.get('SKU') || '',
      price: String(record.get('Price') || '0'),
      cost: String(record.get('Cost per item') || '0'),
      barcode: record.get('barcode') || '',
      inventory_quantity: parseInt(record.get('Qty received') || 0), // CHANGED: From Quantity to Qty received
      inventory_management: 'shopify',
      taxable: record.get('Variant Taxable') !== 'FALSE',
      requires_shipping: record.get('Variant Requires Shipping') !== 'FALSE',
      weight: 0,
      weight_unit: 'g'
    };
    
    const option1Value = record.get('Option1 Value');
    if (option1Value) {
      variant.option1 = option1Value;
    }
    
    grouped[handle].variants.push(variant);
    grouped[handle].recordIds.push(record.id);
    
    const option1Name = record.get('Option1 Name');
    if (option1Name && !grouped[handle].option1Name) {
      grouped[handle].option1Name = option1Name;
    }
  });
  
  return Object.values(grouped);
}

// Sort variants by size (smallest to largest)
function sortVariantsBySizes(variants) {
  // Define size order
  const sizeOrder = {
    'xxxs': 1, 'xxs': 2, 'xs': 3, 'extra small': 3,
    's': 4, 'small': 4,
    'm': 5, 'medium': 5,
    'l': 6, 'large': 6,
    'xl': 7, 'extra large': 7,
    'xxl': 8, '2xl': 8,
    'xxxl': 9, '3xl': 9,
    'xxxxl': 10, '4xl': 10,
    'one size': 99
  };
  
  return variants.sort((a, b) => {
    const sizeA = (a.option1 || '').toLowerCase().trim();
    const sizeB = (b.option1 || '').toLowerCase().trim();
    
    const orderA = sizeOrder[sizeA] || 50; // Default to middle if size not found
    const orderB = sizeOrder[sizeB] || 50;
    
    return orderA - orderB;
  });
}

// Publish product to specific sales channel
async function publishToChannel(accessToken, productId, channelName) {
  try {
    // First, get the publication ID for the channel
    const channelsQuery = `
      query {
        publications(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const channelsResponse = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: channelsQuery })
      }
    );

    const channelsData = await channelsResponse.json();
    
    if (channelsData.errors) {
      console.error(`   ⚠️  Error fetching channels:`, channelsData.errors[0].message);
      return;
    }
    
    // Find the channel by name
    let publicationId = null;
    if (channelsData.data && channelsData.data.publications) {
      for (const edge of channelsData.data.publications.edges) {
        const name = edge.node.name.toLowerCase();
        if ((channelName === 'point_of_sale' && name.includes('point of sale')) ||
            (channelName === 'online_store' && name.includes('online store'))) {
          publicationId = edge.node.id;
          break;
        }
      }
    }
    
    if (!publicationId) {
      console.log(`   ⚠️  Channel ${channelName} not found`);
      return;
    }
    
    // Publish the product to this channel
    const publishMutation = `
      mutation {
        publishablePublish(
          id: "gid://shopify/Product/${productId}"
          input: {
            publicationId: "${publicationId}"
          }
        ) {
          publishable {
            availablePublicationsCount {
              count
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const publishResponse = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: publishMutation })
      }
    );

    const publishData = await publishResponse.json();
    
    if (publishData.data && publishData.data.publishablePublish) {
      if (publishData.data.publishablePublish.userErrors.length > 0) {
        console.error(`   ⚠️  Error publishing:`, publishData.data.publishablePublish.userErrors);
      }
    }
  } catch (error) {
    console.error(`   ⚠️  Failed to publish to ${channelName}:`, error.message);
  }
}

// Update Airtable record status
async function updateAirtableStatus(base, recordId, status, productId = null, errorMessage = null) {
  try {
    const updates = {
      'Shopify Status': status
    };
    
    if (productId) {
      updates['Shopify Product ID'] = productId;
      updates['Shopify Product URL'] = `https://${SHOPIFY_DOMAIN}/admin/products/${productId}`;
      updates['Last Synced'] = new Date().toISOString().split('T')[0];
    }
    
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

// Create product in Shopify
async function createProduct(accessToken, productData, base) {
  try {
    const options = [];
    if (productData.option1Name) {
      options.push({
        name: productData.option1Name
      });
    }
    
    // Sort variants by size before uploading
    const sortedVariants = sortVariantsBySizes(productData.variants);
    
    const payload = {
      product: {
        title: productData.title,
        body_html: productData.body_html,
        vendor: productData.vendor,
        product_type: productData.product_type,
        tags: productData.tags,
        status: productData.status,
        published: productData.published,
        variants: sortedVariants,
        options: options
      }
    };

    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (response.ok && data.product) {
      // Publish to selected channels
      if (productData.publishToPos) {
        await publishToChannel(accessToken, data.product.id, 'point_of_sale');
      }
      if (productData.publishToOnline) {
        await publishToChannel(accessToken, data.product.id, 'online_store');
      }
      
      // Update all Airtable records for this product to "Live/Active"
      for (const recordId of productData.recordIds) {
        await updateAirtableStatus(base, recordId, 'Live/Active', String(data.product.id));
      }
      
      return { success: true, product: data.product };
    } else {
      const errorMsg = JSON.stringify(data.errors || data);
      
      // Update all Airtable records to "Error" status
      for (const recordId of productData.recordIds) {
        await updateAirtableStatus(base, recordId, 'Error', null, errorMsg);
      }
      
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    
    // Update all Airtable records to "Error" status
    for (const recordId of productData.recordIds) {
      await updateAirtableStatus(base, recordId, 'Error', null, error.message);
    }
    
    return { success: false, error: error.message };
  }
}

// Main sync function
async function syncToShopify() {
  const accessToken = await getAccessToken();
  
  const base = new Airtable({
    apiKey: AIRTABLE_API_KEY
  }).base(AIRTABLE_BASE_ID);

  let records;
  try {
    records = await base(AIRTABLE_TABLE_NAME).select().all();
  } catch (err) {
    console.error('❌ Error fetching from Airtable:', err);
    return;
  }

  console.log(`📦 Found ${records.length} records in Airtable`);
      
      const products = groupByHandle(records);
      console.log(`🎯 Found ${products.length} products with "Publish" status\n`);
      
      if (products.length === 0) {
        console.log('ℹ️  No products to upload. Set Shopify Status to "Publish" for items you want to upload.\n');
        return;
      }
      
      let newCount = 0;
      let existingCount = 0;
      let errorCount = 0;
      let variantsAdded = 0;
      
      for (const productData of products) {
        // Get base SKU from first variant to find existing product
        const firstVariantSKU = productData.variants[0]?.sku;
        const baseSKU = getBaseSKU(firstVariantSKU);
        
        // Check if product with matching base SKU already exists
        const skuCheck = await findProductByBaseSKU(baseSKU, accessToken);
        
        if (skuCheck.exists) {
          // Product exists - add new variants to it
          const existingProduct = skuCheck.product;
          const existingProductId = existingProduct.id.toString();
          
          // Get existing variant SKUs
          const existingSKUs = new Set(existingProduct.variants.map(v => v.sku));
          
          // Add only new variants that don't exist yet
          for (let i = 0; i < productData.variants.length; i++) {
            const variant = productData.variants[i];
            const recordId = productData.recordIds[i];
            
            if (!existingSKUs.has(variant.sku)) {
              // This is a new variant - add it
              const result = await addVariantToProduct(accessToken, existingProductId, variant);
              
              if (result.success) {
                await updateAirtableStatus(base, recordId, 'Live/Active', existingProductId);
                variantsAdded++;
              } else {
                await updateAirtableStatus(base, recordId, 'Error', null, result.error);
                errorCount++;
              }
              
              await new Promise(resolve => setTimeout(resolve, 300));
            } else {
              // Variant already exists - just update status
              await updateAirtableStatus(base, recordId, 'Live/Active', existingProductId);
              existingCount++;
            }
          }
        } else {
          // Product doesn't exist - create new one
          const result = await createProduct(accessToken, productData, base);
          if (result.success) {
            newCount++;
          } else {
            errorCount++;
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`\n${'='.repeat(50)}`);
      console.log(`✨ SYNC COMPLETE`);
      console.log(`${'='.repeat(50)}`);
      console.log(`📊 Summary:`);
      console.log(`   ✅ New products created: ${newCount}`);
      console.log(`   📝 Variants added to existing products: ${variantsAdded}`);
      console.log(`   ⏭️  Already in Shopify (skipped): ${existingCount}`);
      if (errorCount > 0) {
        console.log(`   ❌ Errors: ${errorCount}`);
      }
      console.log(`${'='.repeat(50)}\n`);
}

// Run status updates (Archive/Draft) after publish sync
const { syncStatusChanges } = require('./update-status');

syncToShopify().then(() => {
  // Small delay to let the publish sync finish completely
  setTimeout(() => {
    syncStatusChanges();
  }, 3000);
});
