const PRODUCT_QUERY = {
  fields: ['id', 'documentId', 'name', 'slug', 'basePrice', 'active', 'weight', 'width', 'height', 'depth', 'publishedAt'],
  populate: {
    attributes: {
      fields: ['id', 'name', 'type'],
      populate: {
        values: {
          fields: ['id', 'documentId', 'label', 'value', 'publishedAt'],
        },
      },
    },
    variants: {
      fields: ['id', 'documentId', 'sku', 'stock', 'priceOverride', 'active', 'publishedAt'],
      populate: {
        attribute_values: {
          fields: ['id', 'documentId', 'label', 'value', 'publishedAt'],
        },
      },
    },
  },
};

const VARIANT_QUERY = {
  fields: ['id', 'documentId', 'sku', 'stock', 'priceOverride', 'active', 'publishedAt'],
  populate: {
    attribute_values: {
      fields: ['id', 'documentId', 'label', 'value', 'publishedAt'],
    },
    product: {
      fields: ['id', 'documentId', 'name', 'slug', 'basePrice', 'active', 'weight', 'width', 'height', 'depth', 'publishedAt'],
      populate: {
        attributes: {
          fields: ['id', 'name', 'type'],
          populate: {
            values: {
              fields: ['id', 'documentId', 'label', 'value', 'publishedAt'],
            },
          },
        },
      },
    },
  },
};

function parseEntityIdentifier(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return {
      raw: '',
      numericId: null,
      documentId: null,
    };
  }

  const numericId = /^[1-9]\d*$/.test(normalized) ? Number.parseInt(normalized, 10) : null;
  return {
    raw: normalized,
    numericId,
    documentId: numericId ? null : normalized,
  };
}

function buildFilters(identifier) {
  if (identifier.documentId) {
    return { documentId: identifier.documentId };
  }

  if (identifier.numericId) {
    return { id: identifier.numericId };
  }

  return null;
}

function preferPublishedEntry(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  return entries.find((entry) => Boolean(entry?.publishedAt)) || entries[0] || null;
}

async function resolvePublishedDocument(uid, identifier, query = {}) {
  if (!identifier?.raw) {
    return null;
  }

  let documentId = identifier.documentId;

  if (!documentId && identifier.numericId != null) {
    const rawEntry = await strapi.db.query(uid).findOne({
      where: {
        id: identifier.numericId,
      },
      select: ['documentId'],
    });

    if (rawEntry?.documentId) {
      documentId = rawEntry.documentId;
    }
  }

  if (documentId) {
    return strapi.documents(uid).findOne({
      ...query,
      documentId,
      status: 'published',
    });
  }

  if (identifier.numericId != null) {
    return strapi.entityService.findOne(uid, identifier.numericId, query);
  }

  return null;
}

function identifierMatchesEntity(identifier, entity) {
  if (!identifier?.raw || !entity) {
    return false;
  }

  if (identifier.numericId != null && String(entity.id) === String(identifier.numericId)) {
    return true;
  }

  return Boolean(identifier.documentId) && String(entity.documentId || '') === identifier.documentId;
}

function findVariantOnProduct(product, variantIdentifier) {
  if (!product || !variantIdentifier?.raw) {
    return null;
  }

  return preferPublishedEntry(
    (product.variants || []).filter((variant) => identifierMatchesEntity(variantIdentifier, variant))
  );
}

async function findProduct(identifier) {
  return resolvePublishedDocument('api::product.product', identifier, PRODUCT_QUERY);
}

async function findVariant(identifier) {
  return resolvePublishedDocument('api::product-variant.product-variant', identifier, VARIANT_QUERY);
}

async function findAttributeValue(identifier) {
  return resolvePublishedDocument('api::product-attribute-value.product-attribute-value', identifier, {
    fields: ['id', 'documentId', 'label', 'value', 'publishedAt'],
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

function buildShippingDetails(product) {
  return {
    weight: toPositiveNumber(product?.weight),
    weightUnit: 'LB',
    length: toPositiveNumber(product?.depth),
    width: toPositiveNumber(product?.width),
    height: toPositiveNumber(product?.height),
    dimensionUnit: 'IN',
  };
}

function buildVariantLabel(entity) {
  const productName = entity.product?.name || 'Variant';
  const skuSuffix = entity.sku ? ` (SKU: ${entity.sku})` : '';
  return `${productName}${skuSuffix}`;
}

function normalizeSelectedOptions(selectedOptions = []) {
  return selectedOptions
    .map((option) => String(option.optionValueId))
    .filter(Boolean);
}

function resolveAllowedAttributeValueMap(entity, type) {
  if (type === 'variant') {
    return new Map(
      (entity.attribute_values || []).map((attributeValue) => [
        String(attributeValue.id),
        {
          optionValueId: String(attributeValue.id),
          documentId: attributeValue.documentId || '',
          label: attributeValue.label || '',
          value: attributeValue.value || '',
        },
      ])
    );
  }

  const attributeValues = (entity.attributes || []).flatMap((attribute) =>
    (attribute.values || []).map((attributeValue) => ({
      optionValueId: String(attributeValue.id),
      documentId: attributeValue.documentId || '',
      label: attributeValue.label || '',
      value: attributeValue.value || '',
      optionId: String(attribute.id),
      optionName: attribute.name || '',
      optionType: attribute.type || '',
    }))
  );

  return new Map(attributeValues.map((attributeValue) => [attributeValue.optionValueId, attributeValue]));
}

async function resolveSelectedOptionValue(optionValueId, allowedAttributeValues) {
  const directMatch = allowedAttributeValues.get(optionValueId);
  if (directMatch) {
    return directMatch;
  }

  const selectedIdentifier = parseEntityIdentifier(optionValueId);
  const selectedAttributeValue = await findAttributeValue(selectedIdentifier).catch(() => null);
  if (!selectedAttributeValue?.documentId) {
    return null;
  }

  const allowedMatch = (
    Array.from(allowedAttributeValues.values()).find(
      (allowedAttributeValue) => String(allowedAttributeValue.documentId || '') === String(selectedAttributeValue.documentId)
    ) || null
  );

  if (allowedMatch) {
    return allowedMatch;
  }

  return null;
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

      const variantIdentifier = parseEntityIdentifier(it.variantId || it.id);
      const productIdentifier = parseEntityIdentifier(it.productId || (it.variantId ? null : it.id));

      let type = null;
      let entity = null;
      let productEntity = null;

      if (productIdentifier.raw) {
        productEntity = await findProduct(productIdentifier).catch(() => null);
      }

      if (variantIdentifier.raw && productEntity) {
        const productVariant = findVariantOnProduct(productEntity, variantIdentifier);
        if (productVariant) {
          entity = {
            ...productVariant,
            product: productEntity,
            attribute_values: productVariant.attribute_values || [],
          };
          type = 'variant';
        }
      }

      if (!entity && variantIdentifier.raw) {
        entity = await findVariant(variantIdentifier).catch(() => null);
        if (entity) {
          type = 'variant';
        }
      }

      if (!entity && productEntity) {
        entity = productEntity;
        if (entity) {
          type = 'product';
        }
      }

      if (!entity || !type) {
        const err = new Error(`Product or variant not found for item ${it.productId || it.variantId}`);
        err.status = 404;
        throw err;
      }

      const baseProduct = type === 'variant' ? entity.product : entity;
      const expectedProductMatches =
        !productIdentifier.raw ||
        (productIdentifier.numericId != null && String(baseProduct?.id) === String(productIdentifier.numericId)) ||
        (productIdentifier.documentId && String(baseProduct?.documentId || '') === productIdentifier.documentId);

      if (!baseProduct?.id || !expectedProductMatches) {
        const err = new Error('Variant does not belong to the provided product');
        err.status = 400;
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
        const err = new Error(`Price not available for item ${it.productId || it.variantId}`);
        err.status = 500;
        throw err;
      }

      const allowedOptionValues = resolveAllowedAttributeValueMap(entity, type);
      const selectedOptionIds = normalizeSelectedOptions(it.selectedOptions);
      const selectedOptions = [];
      for (const optionValueId of selectedOptionIds) {
        const optionValue = await resolveSelectedOptionValue(optionValueId, allowedOptionValues);
        if (!optionValue) {
          const err = new Error(`Option ${optionValueId} is not allowed for this item`);
          err.status = 400;
          throw err;
        }
        selectedOptions.push(optionValue);
      }

      const priceCents = Math.round(unitPrice * 100);
      const lineTotal = priceCents * quantity;
      subtotal += lineTotal;

      normalized.push({
        id: type === 'variant' ? String(entity.id) : String(baseProduct.id),
        productId: String(baseProduct.id),
        variantId: type === 'variant' ? String(entity.id) : null,
        quantity,
        title: baseProduct.name || 'Item',
        sku: type === 'variant' ? entity.sku || null : null,
        unitPrice: priceCents,
        lineTotal,
        selectedOptions,
        shippingDetails: buildShippingDetails(baseProduct),
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
