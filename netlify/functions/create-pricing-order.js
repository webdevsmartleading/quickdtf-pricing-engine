// netlify/functions/create-pricing-order.js
//
// Calculates price for DTF / UV DTF transfers by size with cumulative
// quantity discounts, then creates a Shopify Draft Order via Admin API
// and returns the invoice (checkout) URL.

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN; // e.g. quickdtf.myshopify.com
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION = '2025-01';

// ---- Pricing Config ----
const RATE_PER_SQIN = {
  dtf: 0.015,
  uv_dtf: 0.06, // 4x regular DTF rate
};

// Cumulative quantity discount tiers (matches client's request / Ninja model)
const DISCOUNT_TIERS = [
  { min: 1, max: 14, discount: 0 },
  { min: 15, max: 49, discount: 0.20 },
  { min: 50, max: 99, discount: 0.30 },
  { min: 100, max: 249, discount: 0.40 },
  { min: 250, max: Infinity, discount: 0.50 },
];

function getDiscountForQty(totalQty) {
  const tier = DISCOUNT_TIERS.find(t => totalQty >= t.min && totalQty <= t.max);
  return tier ? tier.discount : 0;
}

function calcUnitPrice(widthIn, heightIn, productType, totalQtyAcrossDesigns) {
  const rate = RATE_PER_SQIN[productType] || RATE_PER_SQIN.dtf;
  const sqIn = widthIn * heightIn;
  const basePrice = sqIn * rate;
  const discount = getDiscountForQty(totalQtyAcrossDesigns);
  const finalUnitPrice = basePrice * (1 - discount);
  return {
    sqIn: Math.round(sqIn * 100) / 100,
    basePrice: Math.round(basePrice * 100) / 100,
    discount,
    finalUnitPrice: Math.round(finalUnitPrice * 100) / 100,
  };
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);

    // Expected payload:
    // {
    //   designs: [
    //     { widthIn, heightIn, qty, productType: 'dtf' | 'uv_dtf', fileUrl, note, preCut }
    //   ]
    // }
    const designs = body.designs;
    if (!Array.isArray(designs) || designs.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No designs provided' }) };
    }

    // Total quantity across ALL designs in this order (cumulative discount rule)
    const totalQty = designs.reduce((sum, d) => sum + (d.qty || 0), 0);

    const lineItems = designs.map((d) => {
      const calc = calcUnitPrice(d.widthIn, d.heightIn, d.productType, totalQty);
      const title = `${d.productType === 'uv_dtf' ? 'UV DTF Transfer' : 'DTF Transfer'} — ${d.widthIn}" x ${d.heightIn}"`;

      const properties = [
        { name: 'Width', value: `${d.widthIn} in` },
        { name: 'Height', value: `${d.heightIn} in` },
        { name: 'Sq Inches', value: `${calc.sqIn}` },
        { name: 'Discount Applied', value: `${Math.round(calc.discount * 100)}%` },
      ];

      if (d.fileUrl) properties.push({ name: 'Design File', value: d.fileUrl });
      if (d.note) properties.push({ name: 'Design Notes', value: d.note });
      if (d.preCut) properties.push({ name: 'Pre-Cut', value: 'Yes (+$0.19 each)' });

      let unitPrice = calc.finalUnitPrice;
      if (d.preCut) unitPrice = Math.round((unitPrice + 0.19) * 100) / 100;

      return {
        title,
        price: unitPrice.toFixed(2),
        quantity: d.qty,
        properties,
        requires_shipping: true,
        taxable: true,
      };
    });

    // Create Draft Order via Shopify Admin API
    const response = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/draft_orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_TOKEN,
        },
        body: JSON.stringify({
          draft_order: {
            line_items: lineItems,
            use_customer_default_address: true,
            tags: 'custom-pricing-calculator',
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Shopify API error', details: errText }),
      };
    }

    const data = await response.json();
    const invoiceUrl = data.draft_order.invoice_url;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        checkoutUrl: invoiceUrl,
        draftOrderId: data.draft_order.id,
        totalQty,
        lineItems: lineItems.map((li) => ({ title: li.title, price: li.price, quantity: li.quantity })),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: err.message }),
    };
  }
};
