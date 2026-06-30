// netlify/functions/calculate-price.js
//
// Returns live price preview + full discount tier table for the
// frontend calculator widget. No Shopify order is created here.

const RATE_PER_SQIN = {
  dtf: 0.015,
  uv_dtf: 0.06,
};

const DISCOUNT_TIERS = [
  { min: 1, max: 14, discount: 0, label: '1-14 pcs' },
  { min: 15, max: 49, discount: 0.20, label: '15-49' },
  { min: 50, max: 99, discount: 0.30, label: '50-99' },
  { min: 100, max: 249, discount: 0.40, label: '100-249' },
  { min: 250, max: Infinity, discount: 0.50, label: '250+' },
];

function getDiscountForQty(totalQty) {
  const tier = DISCOUNT_TIERS.find(t => totalQty >= t.min && totalQty <= t.max);
  return tier ? tier.discount : 0;
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { widthIn, heightIn, productType, totalQty } = body;

    const rate = RATE_PER_SQIN[productType] || RATE_PER_SQIN.dtf;
    const sqIn = (widthIn || 0) * (heightIn || 0);
    const basePrice = sqIn * rate;

    // Build full discount table for this size
    const table = DISCOUNT_TIERS.map((tier) => {
      const price = basePrice * (1 - tier.discount);
      return {
        label: tier.label,
        discountPercent: Math.round(tier.discount * 100),
        unitPrice: Math.round(price * 100) / 100,
        isCurrent: (totalQty || 0) >= tier.min && (totalQty || 0) <= tier.max,
      };
    });

    const currentDiscount = getDiscountForQty(totalQty || 0);
    const currentUnitPrice = Math.round(basePrice * (1 - currentDiscount) * 100) / 100;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sqIn: Math.round(sqIn * 100) / 100,
        basePrice: Math.round(basePrice * 100) / 100,
        currentDiscount,
        currentUnitPrice,
        table,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
