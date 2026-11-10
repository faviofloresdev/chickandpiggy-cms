'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
module.exports = createCoreService('api::order-change.order-change');
