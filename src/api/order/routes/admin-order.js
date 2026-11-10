'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/orders', handler: 'admin-order.list', config: { auth: false, policies: [] } },
    { method: 'GET', path: '/admin/orders/:id', handler: 'admin-order.detail', config: { auth: false, policies: [] } },
    { method: 'PATCH', path: '/admin/orders/:id', handler: 'admin-order.update', config: { auth: false, policies: [] } },
  ],
};
