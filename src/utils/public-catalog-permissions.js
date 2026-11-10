'use strict';

const PUBLIC_CATALOG_ACTIONS = [
  'api::product-attribute.product-attribute.find',
  'api::product-attribute.product-attribute.findOne',
  'api::product-attribute-value.product-attribute-value.find',
  'api::product-attribute-value.product-attribute-value.findOne',
];

async function ensurePublicCatalogPermissions(strapi) {
  const roleQuery = strapi.db.query('plugin::users-permissions.role');
  const permissionQuery = strapi.db.query('plugin::users-permissions.permission');
  const publicRole = await roleQuery.findOne({
    where: { type: 'public' },
    populate: ['permissions'],
  });

  if (!publicRole) {
    throw new Error('The Strapi public role could not be found');
  }

  const existingActions = new Set(
    (publicRole.permissions || []).map((permission) => permission.action)
  );
  const missingActions = PUBLIC_CATALOG_ACTIONS.filter(
    (action) => !existingActions.has(action)
  );

  await Promise.all(
    missingActions.map((action) =>
      permissionQuery.create({
        data: {
          action,
          role: publicRole.id,
        },
      })
    )
  );

  if (missingActions.length > 0) {
    strapi.log.info(
      `Enabled ${missingActions.length} public catalog relation permissions`
    );
  }

  return missingActions;
}

module.exports = {
  PUBLIC_CATALOG_ACTIONS,
  ensurePublicCatalogPermissions,
};
