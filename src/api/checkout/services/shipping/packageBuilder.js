function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readNumberEnv(name, fallback) {
  const value = toPositiveNumber(process.env[name]);
  return value ?? fallback;
}

function getDefaultPackage() {
  return {
    weight: readNumberEnv('DEFAULT_PACKAGE_WEIGHT_LB', 1),
    weightUnit: (process.env.DEFAULT_PACKAGE_WEIGHT_UNIT || 'LB').toUpperCase(),
    length: readNumberEnv('DEFAULT_PACKAGE_LENGTH_IN', 10),
    width: readNumberEnv('DEFAULT_PACKAGE_WIDTH_IN', 8),
    height: readNumberEnv('DEFAULT_PACKAGE_HEIGHT_IN', 4),
    dimensionUnit: (process.env.DEFAULT_PACKAGE_DIMENSION_UNIT || 'IN').toUpperCase(),
  };
}

function normalizeItemPackage(item) {
  const shipping = item.shippingDetails || {};
  return {
    weight: toPositiveNumber(shipping.weight),
    weightUnit: String(shipping.weightUnit || '').toUpperCase() || null,
    length: toPositiveNumber(shipping.length),
    width: toPositiveNumber(shipping.width),
    height: toPositiveNumber(shipping.height),
    dimensionUnit: String(shipping.dimensionUnit || '').toUpperCase() || null,
  };
}

function average(values) {
  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function buildPackageFromItems(items = []) {
  const fallback = getDefaultPackage();
  const rows = items.map((item) => ({
    quantity: Number.parseInt(item.quantity, 10) || 1,
    pkg: normalizeItemPackage(item),
  }));

  const knownWeights = [];
  const knownLengths = [];
  const knownWidths = [];
  const knownHeights = [];

  for (const row of rows) {
    const { quantity, pkg } = row;

    if (pkg.weight) {
      for (let index = 0; index < quantity; index += 1) {
        knownWeights.push(pkg.weight);
      }
    }

    if (pkg.length) {
      for (let index = 0; index < quantity; index += 1) {
        knownLengths.push(pkg.length);
      }
    }

    if (pkg.width) {
      for (let index = 0; index < quantity; index += 1) {
        knownWidths.push(pkg.width);
      }
    }

    if (pkg.height) {
      for (let index = 0; index < quantity; index += 1) {
        knownHeights.push(pkg.height);
      }
    }
  }

  const averageWeight = average(knownWeights);
  const averageLength = average(knownLengths);
  const averageWidth = average(knownWidths);
  const averageHeight = average(knownHeights);

  let totalWeight = 0;
  let maxLength = 0;
  let maxWidth = 0;
  let totalHeight = 0;
  let foundRealWeightData = false;
  let foundRealDimensionData = false;

  for (const row of rows) {
    const { quantity, pkg } = row;
    const itemWeight = pkg.weight ?? averageWeight;
    const itemLength = pkg.length ?? averageLength;
    const itemWidth = pkg.width ?? averageWidth;
    const itemHeight = pkg.height ?? averageHeight;

    if (itemWeight) {
      totalWeight += itemWeight * quantity;
      foundRealWeightData = true;
    }

    if (itemLength && itemWidth && itemHeight) {
      maxLength = Math.max(maxLength, itemLength);
      maxWidth = Math.max(maxWidth, itemWidth);
      totalHeight += itemHeight * quantity;
      foundRealDimensionData = true;
    }
  }

  return {
    weight: foundRealWeightData ? Number(totalWeight.toFixed(2)) : fallback.weight,
    weightUnit: fallback.weightUnit,
    length: foundRealDimensionData ? Number(maxLength.toFixed(2)) : fallback.length,
    width: foundRealDimensionData ? Number(maxWidth.toFixed(2)) : fallback.width,
    height: foundRealDimensionData ? Number(totalHeight.toFixed(2)) : fallback.height,
    dimensionUnit: fallback.dimensionUnit,
    source: foundRealWeightData || foundRealDimensionData ? 'items' : 'defaults',
  };
}

module.exports = {
  buildPackageFromItems,
};
