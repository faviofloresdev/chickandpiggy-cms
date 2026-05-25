const FLORIDA_SALES_TAX_RATE = 0.06;

module.exports = {
  // destination.shipping is expected to have `country` and `state`
  async calculateTax(subtotalCents, destination) {
    const country = (destination?.country || 'US').toUpperCase();
    const state = (destination?.state || '').toUpperCase();

    // Current business rule: only collect tax for Florida destinations.
    const rate = country === 'US' && state === 'FL' ? FLORIDA_SALES_TAX_RATE : 0;

    const amount = Math.round(subtotalCents * rate);
    return { rate, amount };
  },
};
