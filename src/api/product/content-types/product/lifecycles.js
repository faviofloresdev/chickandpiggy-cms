'use strict';

const { sanitizeBlocks } = require('../../../../utils/blocks');

function sanitizeProductDescription(event) {
  const data = event?.params?.data;

  if (!data || !Array.isArray(data.description)) {
    return;
  }

  data.description = sanitizeBlocks(data.description);
}

module.exports = {
  beforeCreate(event) {
    sanitizeProductDescription(event);
  },

  beforeUpdate(event) {
    sanitizeProductDescription(event);
  },
};
