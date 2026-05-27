'use strict';

const LIST_FORMATS = new Set(['ordered', 'unordered']);
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'quote', 'code', 'list', 'image']);
const INLINE_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createTextNode(text = '') {
  return {
    type: 'text',
    text,
  };
}

function extractPlainText(node) {
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join('');
  }

  if (!isObject(node)) {
    return '';
  }

  const ownText = typeof node.text === 'string' ? node.text : '';
  const childrenText = Array.isArray(node.children) ? node.children.map(extractPlainText).join('') : '';

  return ownText || childrenText;
}

function applyMarks(baseNode, sourceNode) {
  for (const mark of INLINE_MARKS) {
    if (sourceNode[mark] === true) {
      baseNode[mark] = true;
    }
  }

  return baseNode;
}

function normalizeInlineNode(node) {
  if (!isObject(node)) {
    return null;
  }

  if (node.type === 'link') {
    const children = normalizeInlineChildren(node.children);

    return {
      type: 'link',
      url: typeof node.url === 'string' ? node.url : '',
      children: children.length ? children : [createTextNode('')],
    };
  }

  const ownText = typeof node.text === 'string' ? node.text : '';
  const descendantText = extractPlainText(node.children);
  const normalizedText = ownText || descendantText;
  return applyMarks(createTextNode(normalizedText), node);
}

function normalizeInlineChildren(children) {
  if (!Array.isArray(children)) {
    return [createTextNode('')];
  }

  const normalized = children
    .map(normalizeInlineNode)
    .filter(Boolean);

  return normalized.length ? normalized : [createTextNode('')];
}

function normalizeListItem(node) {
  if (!isObject(node)) {
    return null;
  }

  const textPrefix = typeof node.text === 'string' ? node.text : '';
  const inlineChildren = normalizeInlineChildren(node.children);

  if (textPrefix) {
    inlineChildren.unshift(createTextNode(textPrefix));
  }

  return {
    type: 'list-item',
    children: inlineChildren,
  };
}

function normalizeListBlock(node) {
  const rawChildren = Array.isArray(node.children) ? node.children : [];
  const children = rawChildren
    .map(normalizeListItem)
    .filter(Boolean);

  return {
    type: 'list',
    format: LIST_FORMATS.has(node.format) ? node.format : 'unordered',
    children: children.length ? children : [{ type: 'list-item', children: [createTextNode('')] }],
  };
}

function normalizeBlockNode(node) {
  if (!isObject(node)) {
    return null;
  }

  if (node.type === 'paragraph' && LIST_FORMATS.has(node.format)) {
    return normalizeListBlock({
      type: 'list',
      format: node.format,
      children: [{ type: 'list-item', children: node.children }],
    });
  }

  if (node.type === 'list') {
    return normalizeListBlock(node);
  }

  if (node.type === 'heading') {
    return {
      type: 'heading',
      level: Number.isInteger(node.level) ? node.level : 1,
      children: normalizeInlineChildren(node.children),
    };
  }

  if (node.type === 'paragraph' || node.type === 'quote' || node.type === 'code') {
    return {
      type: node.type,
      children: normalizeInlineChildren(node.children),
    };
  }

  if (node.type === 'image') {
    return node;
  }

  if (BLOCK_TYPES.has(node.type)) {
    return {
      type: node.type,
      children: normalizeInlineChildren(node.children),
    };
  }

  const fallbackText = extractPlainText(node);
  return {
    type: 'paragraph',
    children: [createTextNode(fallbackText)],
  };
}

function mergeAdjacentLists(blocks) {
  return blocks.reduce((acc, block) => {
    const previous = acc[acc.length - 1];

    if (
      previous &&
      previous.type === 'list' &&
      block.type === 'list' &&
      previous.format === block.format
    ) {
      previous.children.push(...block.children);
      return acc;
    }

    acc.push(block);
    return acc;
  }, []);
}

function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return blocks;
  }

  const normalized = blocks
    .map(normalizeBlockNode)
    .filter(Boolean);

  return mergeAdjacentLists(normalized);
}

module.exports = {
  sanitizeBlocks,
};
