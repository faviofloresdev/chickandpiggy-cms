async function findProduct(id) {
  return strapi.entityService.findOne('api::product.product', id, {
    fields: ['id', 'name', 'slug', 'basePrice', 'active', 'weight', 'width', 'height', 'depth'],
    populate: {
      product_variants: {
        fields: ['id', 'sku', 'stock', 'priceOverride', 'active'],
      },
    },
  });
}

async function findVariant(id) {
  return strapi.entityService.findOne('api::product-variant.product-variant', id, {
    populate: {
      product: {
        fields: ['id', 'name', 'slug', 'basePrice', 'active', 'weight', 'width', 'height', 'depth'],
      },
    },
  });
}

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveUnitPrice(entity, type) {
  const candidate =
    type === 'variant'
      ? entity.priceOverride ?? entity.product?.basePrice
      : entity.basePrice;
  const price = Number(candidate);
  return Number.isFinite(price) ? price : null;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildShippingDetails(itemShippingDetails, product) {
  return {
    ...(itemShippingDetails || {}),
    weight: toPositiveNumber(itemShippingDetails?.weight) ?? toPositiveNumber(product?.weight),
    weightUnit: itemShippingDetails?.weightUnit || 'LB',
    length: toPositiveNumber(itemShippingDetails?.length) ?? toPositiveNumber(product?.depth),
    width: toPositiveNumber(itemShippingDetails?.width) ?? toPositiveNumber(product?.width),
    height: toPositiveNumber(itemShippingDetails?.height) ?? toPositiveNumber(product?.height),
    dimensionUnit: itemShippingDetails?.dimensionUnit || 'IN',
  };
}

function buildVariantLabel(entity) {
  const productName = entity.product?.name || 'Variant';
  const skuSuffix = entity.sku ? ` (SKU: ${entity.sku})` : '';
  return `${productName}${skuSuffix}`;
}

module.exports = {
  // returns { items: [...], subtotal: cents }
  async validateAndCalculate(items) {
    const normalized = [];
    let subtotal = 0; // cents

    for (const it of items) {
      const quantity = toPositiveInteger(it.quantity);
      if (!quantity) {
        const err = new Error('Invalid item format');
        err.status = 400;
        throw err;
      }

      const variantId = toPositiveInteger(it.variantId || it.id);
      const productId = toPositiveInteger(it.productId || (it.variantId ? null : it.id));

      let type = null;
      let entity = null;

      if (variantId) {
        entity = await findVariant(variantId).catch(() => null);
        if (entity) {
          type = 'variant';
        }
      }

      if (!entity && productId) {
        entity = await findProduct(productId).catch(() => null);
        if (entity) {
          type = 'product';
        }
      }

      if (!entity || !type) {
        const err = new Error(`Product or variant not found for item ${it.id || it.productId || it.variantId}`);
        err.status = 404;
        throw err;
      }

      if (type === 'variant') {
        if (entity.active === false || entity.product?.active === false) {
          const err = new Error(`Variant ${entity.id} is not available`);
          err.status = 400;
          throw err;
        }

        if (entity.stock != null && Number(entity.stock) < quantity) {
          const availableStock = Number(entity.stock);
          const err = new Error(
            `${buildVariantLabel(entity)} does not have enough stock. Requested ${quantity}, available ${availableStock}.`
          );
          err.status = 400;
          err.code = 'INSUFFICIENT_STOCK';
          err.details = {
            variantId: entity.id,
            productId: entity.product?.id || null,
            sku: entity.sku || null,
            requestedQuantity: quantity,
            availableStock,
          };
          throw err;
        }
      } else if (entity.active === false) {
        const err = new Error(`Product ${entity.id} is not available`);
        err.status = 400;
        throw err;
      }

      const unitPrice = resolveUnitPrice(entity, type);
      if (unitPrice == null) {
        const err = new Error(`Price not available for item ${it.id || it.productId || it.variantId}`);
        err.status = 500;
        throw err;
      }

      const priceCents = Math.round(unitPrice * 100);
      const lineTotal = priceCents * quantity;
      subtotal += lineTotal;

      const baseProduct = type === 'variant' ? entity.product : entity;
      normalized.push({
        id: type === 'variant' ? String(entity.id) : String(baseProduct.id),
        productId: String(baseProduct.id),
        variantId: type === 'variant' ? String(entity.id) : null,
        quantity,
        title: baseProduct.name || 'Item',
        sku: type === 'variant' ? entity.sku || null : null,
        unitPrice: priceCents,
        lineTotal,
        selectedOptions: it.selectedOptions || {},
        shippingDetails: buildShippingDetails(it.shippingDetails, baseProduct),
        productSnapshot: {
          productId: baseProduct.id,
          variantId: type === 'variant' ? entity.id : null,
          name: baseProduct.name || 'Item',
          slug: baseProduct.slug || null,
          sku: type === 'variant' ? entity.sku || null : null,
          weight: toPositiveNumber(baseProduct.weight),
          width: toPositiveNumber(baseProduct.width),
          height: toPositiveNumber(baseProduct.height),
          depth: toPositiveNumber(baseProduct.depth),
        },
      });
    }

    return { items: normalized, subtotal };
  },
};
