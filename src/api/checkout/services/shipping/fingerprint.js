const crypto = require('crypto');
const { buildPackageFromItems } = require('./packageBuilder');

function normalizePostalCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function normalizeItems(items = []) {
  return items
    .map((item) => ({
      productId: String(item.productId || item.id || ''),
      variantId: String(item.variantId || ''),
      quantity: Number(item.quantity) || 0,
      shippingDetails: {
        weight: Number(item.shippingDetails?.weight) || 0,
        weightUnit: String(item.shippingDetails?.weightUnit || 'LB').toUpperCase(),
        length: Number(item.shippingDetails?.length) || 0,
        width: Number(item.shippingDetails?.width) || 0,
        height: Number(item.shippingDetails?.height) || 0,
        dimensionUnit: String(item.shippingDetails?.dimensionUnit || 'IN').toUpperCase(),
      },
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildRateFingerprint({ origin, destination, items }) {
  const parcel = buildPackageFromItems(items);
  const payload = {
    originZip: normalizePostalCode(origin?.postalCode),
    destinationZip: normalizePostalCode(destination?.postalCode),
    cartItems: normalizeItems(items),
    weight: parcel.weight,
    weightUnit: parcel.weightUnit,
    dimensions: {
      length: parcel.length,
      width: parcel.width,
      height: parcel.height,
      unit: parcel.dimensionUnit,
    },
  };

  return {
    fingerprint: hashPayload(payload),
    packageSnapshot: payload,
  };
}

function buildServiceFingerprint({ requestFingerprint, carrier, service }) {
  return hashPayload({
    requestFingerprint,
    carrier: String(carrier || '').trim().toLowerCase(),
    service: String(service || '').trim().toLowerCase(),
  });
}

module.exports = {
  buildRateFingerprint,
  buildServiceFingerprint,
};
