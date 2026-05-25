'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

function normalizePercentageValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  // Support legacy fraction-style percentages like 0.1 for 10%.
  if (parsed > 0 && parsed <= 1) {
    return parsed * 100;
  }

  return parsed;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function assertDiscountIsUsable(discount) {
  if (!discount.active) {
    throw createError('Discount code is inactive');
  }
}

module.exports = createCoreService('api::discount.discount', ({ strapi }) => ({
  async findByCode(code) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
      return null;
    }

    const entries = await strapi.entityService.findMany('api::discount.discount', {
      filters: {
        code: {
          $eqi: normalizedCode,
        },
      },
      limit: 1,
    });

    const discount = Array.isArray(entries) ? entries[0] : entries;
    if (!discount) {
      return null;
    }

    return {
      ...discount,
      code: normalizeCode(discount.code),
    };
  },

  async resolveDiscount({ code, subtotalCents }) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
      return null;
    }

    const discount = await this.findByCode(normalizedCode);
    if (!discount) {
      throw createError('Discount code not found', 404);
    }

    assertDiscountIsUsable(discount);

    let amountCents = 0;
    if (discount.type === 'percentage') {
      amountCents = Math.round(subtotalCents * (normalizePercentageValue(discount.value) / 100));
    } else {
      amountCents = toCents(discount.value);
    }

    amountCents = Math.max(0, Math.min(subtotalCents, amountCents));

    return {
      id: discount.id,
      documentId: discount.documentId || null,
      name: discount.name,
      code: discount.code,
      type: discount.type,
      value: Number(discount.value) || 0,
      amountCents,
      amount: amountCents / 100,
      currency: 'usd',
    };
  },

  async inspectDiscount({ code }) {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) {
      throw createError('Discount code is required');
    }

    const discount = await this.findByCode(normalizedCode);
    if (!discount) {
      throw createError('Discount code not found', 404);
    }

    assertDiscountIsUsable(discount);

    return {
      id: discount.id,
      documentId: discount.documentId || null,
      name: discount.name,
      code: discount.code,
      type: discount.type,
      value: Number(discount.value) || 0,
      currency: 'usd',
    };
  },
}));
