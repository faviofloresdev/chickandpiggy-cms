'use strict';

/**
 * featured-product service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::featured-product.featured-product');
