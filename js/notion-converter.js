// js/notion-converter.js — Bidirectional converter between Tiptap JSON and Notion blocks

/**
 * Convert Notion blocks → Tiptap JSON document
 */
export function notionBlocksToTiptap(blocks) {
  const content = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    const type = block.type;

    // Collect consecutive list items into a single list node
    if (type === 'bulleted_list_item') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        items.push(convertListItem(blocks[i]));
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    if (type === 'numbered_list_item') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        items.push(convertListItem(blocks[i]));
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    if (type === 'to_do') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'to_do') {
        items.push(convertTodoItem(blocks[i]));
        i++;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    const node = convertBlock(block);
    if (node) content.push(node);
    i++;
  }

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

function convertBlock(block) {
  const type = block.type;

  switch (type) {
    case 'paragraph':
      return {
        type: 'paragraph',
        content: richTextToTiptap(block.paragraph?.rich_text),
      };

    case 'heading_1':
      return {
        type: 'heading',
        attrs: { level: 1 },
        content: richTextToTiptap(block.heading_1?.rich_text),
      };

    case 'heading_2':
      return {
        type: 'heading',
        attrs: { level: 2 },
        content: richTextToTiptap(block.heading_2?.rich_text),
      };

    case 'heading_3':
      return {
        type: 'heading',
        attrs: { level: 3 },
        content: richTextToTiptap(block.heading_3?.rich_text),
      };

    case 'quote':
      return {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: richTextToTiptap(block.quote?.rich_text),
          },
        ],
      };

    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: block.code?.language || null },
        content: richTextToTiptap(block.code?.rich_text),
      };

    case 'divider':
      return { type: 'horizontalRule' };

    case 'callout':
      // Render callout as a blockquote with emoji prefix
      const emoji = block.callout?.icon?.emoji || '💡';
      const calloutText = richTextToTiptap(block.callout?.rich_text);
      const prefix = [{ type: 'text', text: emoji + ' ' }];
      return {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [...prefix, ...(calloutText || [])],
          },
        ],
      };

    case 'toggle':
      // Render toggle as a details/summary block via custom node
      // Falls back to blockquote if toggle extension not available
      const toggleContent = [];
      const summaryText = richTextToTiptap(block.toggle?.rich_text);
      toggleContent.push({
        type: 'paragraph',
        attrs: { class: 'toggle-summary' },
        content: [{ type: 'text', text: '▸ ' }, ...(summaryText || [])],
      });
      if (block.children?.length) {
        const innerDoc = notionBlocksToTiptap(block.children);
        toggleContent.push(...(innerDoc.content || []));
      }
      return {
        type: 'blockquote',
        attrs: { class: 'toggle-block' },
        content: toggleContent,
      };

    case 'image':
      // Skip images for now — could add image extension later
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: `[Image: ${block.image?.caption?.[0]?.plain_text || 'image'}]` }],
      };

    case 'bookmark':
      return {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: block.bookmark?.url || 'bookmark',
          marks: block.bookmark?.url ? [{ type: 'link', attrs: { href: block.bookmark.url } }] : [],
        }],
      };

    default:
      // Unsupported block type — render as paragraph with type info
      return null;
  }
}

function convertListItem(block) {
  const textKey = block.type; // 'bulleted_list_item' or 'numbered_list_item'
  const content = [{
    type: 'paragraph',
    content: richTextToTiptap(block[textKey]?.rich_text),
  }];

  // Handle nested children
  if (block.children?.length) {
    const nested = notionBlocksToTiptap(block.children);
    // If nested content contains lists, add them as children of this listItem
    content.push(...(nested.content || []));
  }

  return { type: 'listItem', content };
}

function convertTodoItem(block) {
  return {
    type: 'taskItem',
    attrs: { checked: block.to_do?.checked || false },
    content: [{
      type: 'paragraph',
      content: richTextToTiptap(block.to_do?.rich_text),
    }],
  };
}

/**
 * Convert Notion rich_text array → Tiptap inline content
 */
function richTextToTiptap(richText) {
  if (!richText?.length) return undefined;

  return richText.map(segment => {
    const marks = [];
    const ann = segment.annotations || {};

    if (ann.bold) marks.push({ type: 'bold' });
    if (ann.italic) marks.push({ type: 'italic' });
    if (ann.strikethrough) marks.push({ type: 'strike' });
    if (ann.underline) marks.push({ type: 'underline' });
    if (ann.code) marks.push({ type: 'code' });
    if (ann.color && ann.color !== 'default') {
      const color = notionColorToCSS(ann.color);
      if (ann.color.endsWith('_background')) {
        marks.push({ type: 'highlight', attrs: { color } });
      } else {
        marks.push({ type: 'textStyle', attrs: { color } });
      }
    }

    if (segment.href) {
      marks.push({ type: 'link', attrs: { href: segment.href, target: '_blank' } });
    }

    const node = { type: 'text', text: segment.plain_text || segment.text?.content || '' };
    if (marks.length > 0) node.marks = marks;
    return node;
  });
}

// ──────────────────────────────────────────
// Tiptap JSON → Notion blocks
// ──────────────────────────────────────────

/**
 * Convert Tiptap JSON document → Notion blocks array
 */
export function tiptapToNotionBlocks(doc) {
  if (!doc?.content) return [];
  const blocks = [];

  for (const node of doc.content) {
    const converted = convertTiptapNode(node);
    if (converted) {
      if (Array.isArray(converted)) {
        blocks.push(...converted);
      } else {
        blocks.push(converted);
      }
    }
  }

  return blocks;
}

function convertTiptapNode(node) {
  switch (node.type) {
    case 'paragraph':
      return {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: tiptapContentToRichText(node.content) },
      };

    case 'heading':
      const level = node.attrs?.level || 1;
      const headingType = `heading_${Math.min(level, 3)}`;
      return {
        object: 'block',
        type: headingType,
        [headingType]: { rich_text: tiptapContentToRichText(node.content) },
      };

    case 'bulletList':
      return (node.content || []).map(item => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: tiptapContentToRichText(getListItemText(item)),
        },
      }));

    case 'orderedList':
      return (node.content || []).map(item => ({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: tiptapContentToRichText(getListItemText(item)),
        },
      }));

    case 'taskList':
      return (node.content || []).map(item => ({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: tiptapContentToRichText(getListItemText(item)),
          checked: item.attrs?.checked || false,
        },
      }));

    case 'blockquote':
      // Flatten blockquote paragraphs into a single quote block
      const quoteText = (node.content || [])
        .filter(n => n.type === 'paragraph')
        .flatMap(n => n.content || []);
      return {
        object: 'block',
        type: 'quote',
        quote: { rich_text: tiptapContentToRichText(quoteText) },
      };

    case 'codeBlock':
      const lang = node.attrs?.language || 'plain text';
      return {
        object: 'block',
        type: 'code',
        code: {
          rich_text: tiptapContentToRichText(node.content),
          language: lang,
        },
      };

    case 'horizontalRule':
      return { object: 'block', type: 'divider', divider: {} };

    default:
      return null;
  }
}

function getListItemText(listItem) {
  // listItem.content is [paragraph, ...nestedLists]
  // We only want the first paragraph's content
  if (!listItem?.content?.length) return [];
  const firstPara = listItem.content.find(n => n.type === 'paragraph');
  return firstPara?.content || [];
}

/**
 * Convert Tiptap inline content → Notion rich_text array
 */
function tiptapContentToRichText(content) {
  if (!content?.length) return [];

  return content
    .filter(node => node.type === 'text' && node.text)
    .map(node => {
      const annotations = {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      };

      let href = null;

      for (const mark of (node.marks || [])) {
        switch (mark.type) {
          case 'bold': annotations.bold = true; break;
          case 'italic': annotations.italic = true; break;
          case 'strike': annotations.strikethrough = true; break;
          case 'underline': annotations.underline = true; break;
          case 'code': annotations.code = true; break;
          case 'link': href = mark.attrs?.href || null; break;
          case 'textStyle':
            if (mark.attrs?.color) {
              annotations.color = cssColorToNotion(mark.attrs.color);
            }
            break;
          case 'highlight':
            if (mark.attrs?.color) {
              annotations.color = cssColorToNotionBg(mark.attrs.color);
            }
            break;
        }
      }

      const segment = {
        type: 'text',
        text: { content: node.text, link: href ? { url: href } : null },
        annotations,
      };

      return segment;
    });
}

// ──────────────────────────────────────────
// Color mapping helpers
// ──────────────────────────────────────────

const NOTION_COLORS = {
  default: 'inherit',
  gray: '#787774',
  brown: '#9F6B53',
  orange: '#D9730D',
  yellow: '#CB912F',
  green: '#448361',
  blue: '#337EA9',
  purple: '#9065B0',
  pink: '#C14C8A',
  red: '#D44C47',
  gray_background: '#F1F1EF',
  brown_background: '#F4EEEE',
  orange_background: '#FBECDD',
  yellow_background: '#FBF3DB',
  green_background: '#EDF3EC',
  blue_background: '#E7F3F8',
  purple_background: '#F6F3F9',
  pink_background: '#FAF1F5',
  red_background: '#FDEBEC',
};

function notionColorToCSS(notionColor) {
  return NOTION_COLORS[notionColor] || notionColor;
}

function cssColorToNotion(cssColor) {
  for (const [name, value] of Object.entries(NOTION_COLORS)) {
    if (value.toLowerCase() === cssColor.toLowerCase() && !name.endsWith('_background')) {
      return name;
    }
  }
  return 'default';
}

function cssColorToNotionBg(cssColor) {
  for (const [name, value] of Object.entries(NOTION_COLORS)) {
    if (value.toLowerCase() === cssColor.toLowerCase() && name.endsWith('_background')) {
      return name;
    }
  }
  return 'yellow_background';
}
