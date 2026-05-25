function normalizeRate({ id, carrier, service, amount, estimatedDays, description }) {
  return {
    id,
    carrier,
    service,
    amount: Number(amount),
    estimatedDays: estimatedDays || null,
    deliveryEstimateText: estimatedDays ? `Estimated delivery in ${estimatedDays} business days` : null,
    description: description || 'Live carrier rate calculated by Strapi.',
  };
}

module.exports = { normalizeRate };
