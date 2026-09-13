'use strict';

const { assertInternalAdmin } = require('../utils/admin-order');

function fail(ctx, error) {
  ctx.status = Number(error.status) || 500;
  ctx.body = { error: ctx.status >= 500 ? 'Administrative order request failed' : error.message };
  if (ctx.status >= 500) strapi.log.error('admin-order error', error);
}

module.exports = {
  async list(ctx) {
    try {
      assertInternalAdmin(ctx);
      ctx.body = await strapi.service('api::order.admin-order').list(ctx.query || {});
    } catch (error) { fail(ctx, error); }
  },
  async detail(ctx) {
    try {
      assertInternalAdmin(ctx);
      ctx.body = { data: await strapi.service('api::order.admin-order').detail(ctx.params.id) };
    } catch (error) { fail(ctx, error); }
  },
  async update(ctx) {
    try {
      const actor = assertInternalAdmin(ctx);
      ctx.body = { data: await strapi.service('api::order.admin-order').update(ctx.params.id, ctx.request.body || {}, actor) };
    } catch (error) { fail(ctx, error); }
  },
};
