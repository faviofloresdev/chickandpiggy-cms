'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_CATALOG_ACTIONS,
  ensurePublicCatalogPermissions,
} = require('../../src/utils/public-catalog-permissions');

function createStrapi(existingActions = []) {
  const created = [];
  const roleQuery = {
    findOne: async () => ({
      id: 2,
      type: 'public',
      permissions: existingActions.map((action, index) => ({ id: index + 1, action })),
    }),
  };
  const permissionQuery = {
    create: async ({ data }) => {
      created.push(data);
      return data;
    },
  };

  return {
    created,
    strapi: {
      db: {
        query(uid) {
          if (uid === 'plugin::users-permissions.role') return roleQuery;
          if (uid === 'plugin::users-permissions.permission') return permissionQuery;
          throw new Error(`Unexpected query: ${uid}`);
        },
      },
      log: { info() {} },
    },
  };
}

test('enables the public permissions needed to populate product colors', async () => {
  const { strapi, created } = createStrapi();

  const added = await ensurePublicCatalogPermissions(strapi);

  assert.deepEqual(added, PUBLIC_CATALOG_ACTIONS);
  assert.deepEqual(
    created,
    PUBLIC_CATALOG_ACTIONS.map((action) => ({ action, role: 2 }))
  );
});

test('does not duplicate existing public catalog permissions', async () => {
  const { strapi, created } = createStrapi(PUBLIC_CATALOG_ACTIONS);

  const added = await ensurePublicCatalogPermissions(strapi);

  assert.deepEqual(added, []);
  assert.deepEqual(created, []);
});
