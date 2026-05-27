'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeBlocks } = require('../../src/utils/blocks');

test('sanitizeBlocks converts malformed paragraph lists into valid list blocks', () => {
  const input = [
    {
      type: 'paragraph',
      format: 'unordered',
      children: [
        {
          type: 'text',
          text: '',
          children: [{ type: 'text', text: 'Hydrates' }],
        },
      ],
    },
    {
      type: 'list',
      format: 'unordered',
      children: [
        {
          type: 'list-item',
          text: '',
          children: [{ type: 'text', text: 'Soothes' }],
        },
      ],
    },
  ];

  assert.deepEqual(sanitizeBlocks(input), [
    {
      type: 'list',
      format: 'unordered',
      children: [
        {
          type: 'list-item',
          children: [{ type: 'text', text: 'Hydrates' }],
        },
        {
          type: 'list-item',
          children: [{ type: 'text', text: 'Soothes' }],
        },
      ],
    },
  ]);
});

test('sanitizeBlocks preserves inline marks while flattening broken text nodes', () => {
  const input = [
    {
      type: 'paragraph',
      children: [
        {
          type: 'text',
          text: '',
          bold: true,
          children: [{ type: 'text', text: 'Properties of Aloe Vera' }],
        },
      ],
    },
  ];

  assert.deepEqual(sanitizeBlocks(input), [
    {
      type: 'paragraph',
      children: [{ type: 'text', text: 'Properties of Aloe Vera', bold: true }],
    },
  ]);
});
