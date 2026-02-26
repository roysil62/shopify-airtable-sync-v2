// Upload NEW products from Airtable TO Shopify
// Trigger: Shopify Status = "Publish"
// After upload: Changes status to "Live/Active" or "Error"
// RESTOCK: If "Restock √" is checked, updates existing Shopify product instead of creating new

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
      for (const edge of data.data.productVariants.edges) {
        const product = edge.node.product;
        const variantSKUs = product.variants.edges.map(v => v.node.sku);

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
        productId: existingProduct.product.id.split('/').pop(),
        variantId: existingProduct.id.split('/').pop()
      };
    }

    return { exists: false };
  } catch (error) {
    console.error(`Error checking SKU ${sku}:`, error.message);
    return { exists: false };
  }
}

// Find existing Shopify product by Product ID
async function findProductById(productId, accessToken) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products/${productId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) return { exists: false };

    const data = await response.json();
    if (data.product) {
      return { exists: true, product: data.product };
    }
    return { exists: false };
  } catch (error) {
    return { exists: false };
  }
}

// Find existing Shopify product by title
async function findProductByTitle(title, accessToken) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?title=${encodeURIComponent(title)}`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    if (data.products && data.products.length > 0) {
      return { exists: true, product: data.products[0] };
    }
    return { exists: false };
  } catch (error) {
    return { exists: false };
  }
}

// Update existing variant on Shopify (price, cost, SKU, inventory)
async function updateVariantOnShopify(accessToken, variantId, updates) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/variants/${variantId}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ variant: { id: variantId, ...updates } })
      }
    );

    const data = await response.json();
    if (response.ok && data.variant) {
      return { success: true, variant: data.variant };
    }
    return { success: false, error: JSON.stringify(data.errors || data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Update product tags on Shopify (append new tags without removing old ones)
async function appendTagsOnShopify(accessToken, productId, newTags, existingTags) {
  try {
    // Merge old and new tags
    const oldTagSet = new Set(existingTags.split(',').map(t => t.trim()).filter(t => t));
    const newTagList = newTags.split(',').map(t => t.trim()).filter(t => t);

    for (const tag of newTagList) {
      oldTagSet.add(tag);
    }

    const mergedTags = [...oldTagSet].join(', ');

    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products/${productId}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ product: { id: productId, tags: mergedTags } })
      }
    );

    const data = await response.json();
    if (response.ok && data.product) {
      return { success: true };
    }
    return { success: false, error: JSON.stringify(data.errors || data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Set inventory level for a variant at a location
async function setInventoryLevel(accessToken, inventoryItemId, quantity) {
  try {
    // First get the location ID
    const locResponse = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/locations.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    const locData = await locResponse.json();
    if (!locData.locations || locData.locations.length === 0) {
      return { success: false, error: 'No locations found' };
    }
    const locationId = locData.locations[0].id;

    // Set inventory level
    const response = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/inventory_levels/set.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: inventoryItemId,
          available: quantity
        })
      }
    );

    const data = await response.json();
    if (response.ok) {
      return { success: true };
    }
    return { success: false, error: JSON.stringify(data.errors || data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Handle restock: find existing product and update price/cost/qty/tags/SKU
async function handleRestock(accessToken, productData, base) {
  const results = { updated: 0, errors: 0 };

  for (let i = 0; i < productData.variants.length; i++) {
    const variant = productData.variants[i];
    const recordId = productData.recordIds[i];
    const manualProductId = productData.shopifyProductId;

    let shopifyProduct = null;
    let matchedVariant = null;

    // PRIORITY 1: Find by Shopify Product ID (manually added by user)
    if (manualProductId) {
      const result = await findProductById(manualProductId, accessToken);
      if (result.exists) {
        shopifyProduct = result.product;
      }
    }

    // PRIORITY 2: Find by SKU
    if (!shopifyProduct && variant.sku) {
      const skuResult = await productExistsBySKU(variant.sku, accessToken);
      if (skuResult.exists) {
        const prodResult = await findProductById(skuResult.productId, accessToken);
        if (prodResult.exists) {
          shopifyProduct = prodResult.product;
        }
      }
    }

    // PRIORITY 3: Find by title/name
    if (!shopifyProduct && productData.title) {
      const titleResult = await findProductByTitle(productData.title, accessToken);
      if (titleResult.exists) {
        shopifyProduct = titleResult.product;
      }
    }

    if (!shopifyProduct) {
      await updateAirtableStatus(base, recordId, 'Error', null,
        `DUPLICATE/RESTOCK: Item not found on Shopify. "${productData.title}" (SKU: ${variant.sku}) — did not create a new product.`);
      results.errors++;
      continue;
    }

    // Find the matching variant on Shopify (by SKU or first variant)
    if (variant.sku) {
      matchedVariant = shopifyProduct.variants.find(v => v.sku === variant.sku);
    }
    if (!matchedVariant && shopifyProduct.variants.length > 0) {
      if (variant.option1) {
        matchedVariant = shopifyProduct.variants.find(v => v.option1 === variant.option1);
      }
      if (!matchedVariant && shopifyProduct.variants.length === 1) {
        matchedVariant = shopifyProduct.variants[0];
      }
    }

    if (!matchedVariant) {
      await updateAirtableStatus(base, recordId, 'Error', null,
        `DUPLICATE/RESTOCK: Found product "${shopifyProduct.title}" but could not match variant (SKU: ${variant.sku}) — did not create a new product.`);
      results.errors++;
      continue;
    }

    // Track changes for the log
    const changes = [];
    const oldSku = matchedVariant.sku || '';
    const oldPrice = matchedVariant.price || '0';

    // Get old cost from inventory item
    let oldCost = '0';
    if (matchedVariant.inventory_item_id) {
      try {
        const costRes = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/inventory_items/${matchedVariant.inventory_item_id}.json`,
          { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
        );
        const costData = await costRes.json();
        if (costData.inventory_item) {
          oldCost = costData.inventory_item.cost || '0';
        }
      } catch (e) {}
    }

    // Get old inventory quantity
    let oldQty = 'unknown';
    if (matchedVariant.inventory_quantity !== undefined) {
      oldQty = String(matchedVariant.inventory_quantity);
    }

    // Update the variant: price, SKU
    const variantUpdates = {
      price: variant.price,
      sku: variant.sku
    };

    const variantResult = await updateVariantOnShopify(accessToken, matchedVariant.id, variantUpdates);
    if (!variantResult.success) {
      await updateAirtableStatus(base, recordId, 'Error', null,
        `RESTOCK: Failed to update variant - ${variantResult.error}`);
      results.errors++;
      continue;
    }

    // Log SKU change
    if (oldSku !== variant.sku) {
      changes.push(`SKU: "${oldSku}" → "${variant.sku}"`);
    } else {
      changes.push(`SKU: "${variant.sku}" (no change)`);
    }

    // Log price change
    if (oldPrice !== variant.price) {
      changes.push(`Price: $${oldPrice} → $${variant.price}`);
    } else {
      changes.push(`Price: $${variant.price} (no change)`);
    }

    // Update cost (via inventory item)
    if (variant.cost && variantResult.variant.inventory_item_id) {
      try {
        await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/inventory_items/${variantResult.variant.inventory_item_id}.json`,
          {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ inventory_item: { id: variantResult.variant.inventory_item_id, cost: variant.cost } })
          }
        );
      } catch (e) {}
    }

    // Log cost change
    if (oldCost !== variant.cost) {
      changes.push(`Cost: $${oldCost} → $${variant.cost}`);
    } else {
      changes.push(`Cost: $${variant.cost} (no change)`);
    }

    // Set inventory quantity (replace with Qty received from Airtable)
    if (variantResult.variant.inventory_item_id) {
      const invResult = await setInventoryLevel(accessToken, variantResult.variant.inventory_item_id, variant.inventory_quantity);
      if (!invResult.success) {
        changes.push(`Qty: failed to update (${invResult.error})`);
      } else {
        changes.push(`Qty: ${oldQty} → ${variant.inventory_quantity}`);
      }
    }

    // Append tags (don't delete old ones)
    if (productData.tags) {
      const oldTags = shopifyProduct.tags || '';
      await appendTagsOnShopify(accessToken, shopifyProduct.id, productData.tags, oldTags);
      changes.push(`Tags added: "${productData.tags}"`);
    }

    // Build change log message
    const changeLog = `RESTOCK UPDATE (${new Date().toISOString().split('T')[0]}):\n${changes.join('\n')}`;

    // Update Airtable status to Live/Active with change log in Sync Error Message
    await updateAirtableStatus(base, recordId, 'Live/Active', String(shopifyProduct.id), changeLog);
    results.updated++;

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  return results;
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
          const filtered = value.filter(v => v && typeof v === 'string');
          if (filtered.length > 0) {
            return filtered[0];
          }
          return '';
        }
        return String(value);
      };

      const toTitleCase = (str) => {
        if (!str) return '';
        return str.toLowerCase()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      };

      const brandValue = record.get('Brand') || '';
      const vendor = toTitleCase(brandValue);

      let salesChannels = record.get('Sales Channel');
      let publishToPos = true;
      let publishToOnline = false;

      if (salesChannels && Array.isArray(salesChannels)) {
        const channelSet = new Set(salesChannels.map(c => c.toLowerCase()));
        publishToPos = channelSet.has('point of sale (store pos)');
        publishToOnline = channelSet.has('shopify website');
      }

      // Check if this is a restock item
      const restockField = record.get('Restock √ (from Line Item)');
      const isRestock = restockField && (
        restockField === true ||
        restockField === 'checked' ||
        (Array.isArray(restockField) && restockField.length > 0 && restockField[0])
      );

      // Get manually added Shopify Product ID (for restocks)
      const shopifyProductId = record.get('Shopify Product ID') || '';

      grouped[handle] = {
        handle: handle,
        title: record.get('Name') || '',
        product_type: toString(record.get('Product Type')),
        vendor: vendor,
        tags: toString(record.get('Tags')),
        body_html: toString(record.get('Description')),
        status: 'active',
        published: false,
        publishToPos: publishToPos,
        publishToOnline: publishToOnline,
        isRestock: isRestock,
        shopifyProductId: shopifyProductId,
        variants: [],
        recordIds: []
      };
    }

    // Add variant
    const variant = {
      sku: record.get('SKU') || '',
      price: String(record.get('Price') || '0'),
      cost: String(record.get('Cost per item') || '0'),
      barcode: record.get('barcode') || '',
      inventory_quantity: parseInt(record.get('Qty received') || 0),
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

    // If any variant in the group has restock checked, mark the whole group
    const restockField = record.get('Restock √ (from Line Item)');
    const isRestock = restockField && (
      restockField === true ||
      restockField === 'checked' ||
      (Array.isArray(restockField) && restockField.length > 0 && restockField[0])
    );
    if (isRestock) {
      grouped[handle].isRestock = true;
    }

    // If any variant has a manually added Product ID, use it
    const shopifyProductId = record.get('Shopify Product ID');
    if (shopifyProductId && !grouped[handle].shopifyProductId) {
      grouped[handle].shopifyProductId = shopifyProductId;
    }
  });

  return Object.values(grouped);
}

// Sort variants by size (smallest to largest)
function sortVariantsBySizes(variants) {
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

    const orderA = sizeOrder[sizeA] || 50;
    const orderB = sizeOrder[sizeB] || 50;

    return orderA - orderB;
  });
}

// Publish product to specific sales channel
async function publishToChannel(accessToken, productId, channelName) {
  try {
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
      return;
    }

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

    if (!publicationId) return;

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

    await fetch(
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
      updates['Sync Error Message'] = '';
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
      if (productData.publishToPos) {
        await publishToChannel(accessToken, data.product.id, 'point_of_sale');
      }
      if (productData.publishToOnline) {
        await publishToChannel(accessToken, data.product.id, 'online_store');
      }

      for (const recordId of productData.recordIds) {
        await updateAirtableStatus(base, recordId, 'Live/Active', String(data.product.id));
      }

      return { success: true, product: data.product };
    } else {
      const errorMsg = JSON.stringify(data.errors || data);

      for (const recordId of productData.recordIds) {
        await updateAirtableStatus(base, recordId, 'Error', null, errorMsg);
      }

      return { success: false, error: errorMsg };
    }
  } catch (error) {
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
  console.log(`🎯 Found ${products.length} products with "Publish" status`);

  // Separate restock items from new items
  const newProducts = products.filter(p => !p.isRestock);
  const restockProducts = products.filter(p => p.isRestock);
  console.log(`   📦 New items: ${newProducts.length}`);
  console.log(`   🔄 Restock items: ${restockProducts.length}\n`);

  if (products.length === 0) {
    console.log('ℹ️  No products to upload. Set Shopify Status to "Publish" for items you want to upload.\n');
    return;
  }

  let newCount = 0;
  let existingCount = 0;
  let errorCount = 0;
  let variantsAdded = 0;
  let restockUpdated = 0;
  let restockErrors = 0;

  // ============================================
  // HANDLE RESTOCK ITEMS
  // ============================================
  for (const productData of restockProducts) {
    console.log(`🔄 RESTOCK: ${productData.title}`);
    const result = await handleRestock(accessToken, productData, base);
    restockUpdated += result.updated;
    restockErrors += result.errors;
  }

  // ============================================
  // HANDLE NEW ITEMS (existing logic)
  // ============================================
  for (const productData of newProducts) {
    const firstVariantSKU = productData.variants[0]?.sku;
    const baseSKU = getBaseSKU(firstVariantSKU);

    const skuCheck = await findProductByBaseSKU(baseSKU, accessToken);

    if (skuCheck.exists) {
      const existingProduct = skuCheck.product;
      const existingProductId = existingProduct.id.toString();

      const existingSKUs = new Set(existingProduct.variants.map(v => v.sku));

      for (let i = 0; i < productData.variants.length; i++) {
        const variant = productData.variants[i];
        const recordId = productData.recordIds[i];

        if (!existingSKUs.has(variant.sku)) {
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
          await updateAirtableStatus(base, recordId, 'Live/Active', existingProductId);
          existingCount++;
        }
      }
    } else {
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
  console.log(`   🔄 Restock updated: ${restockUpdated}`);
  if (errorCount > 0 || restockErrors > 0) {
    console.log(`   ❌ Errors: ${errorCount + restockErrors} (new: ${errorCount}, restock: ${restockErrors})`);
  }
  console.log(`${'='.repeat(50)}\n`);
}

// Run status updates (Archive/Draft) after publish sync
const { syncStatusChanges } = require('./update-status');

syncToShopify().then(() => {
  setTimeout(() => {
    syncStatusChanges();
  }, 3000);
});
