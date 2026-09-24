import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function safeLink(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  if (value.startsWith('#')) {
    try { return `#md-${decodeURIComponent(value.slice(1))}`; }
    catch { return null; }
  }
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function linkTag(attributes, image = false) {
  const href = safeLink(image ? attributes.src : attributes.href);
  const title = attributes.title ?? (image ? attributes.src : attributes.href);
  return {
    tagName: href ? 'a' : 'span',
    attribs: href ? { href, ...(title ? { title } : {}), ...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' }) } : title ? { title } : {},
    ...(image ? { text: attributes.alt || '[image]' } : {}),
  };
}

export function renderMarkdown(content) {
  const source = content.replace(/^\uFEFF/, '');
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
  const body = frontmatter ? source.slice(frontmatter[0].length) : source;
  const headings = new Map();
  const parser = new Marked({ gfm: true, breaks: false, async: false });
  parser.use({ renderer: {
    heading(token) {
      const inline = this.parser.parseInline(token.tokens);
      const plain = sanitizeHtml(inline, { allowedTags: [], allowedAttributes: {} });
      const base = plain.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const occurrence = headings.get(base) ?? 0;
      headings.set(base, occurrence + 1);
      const id = `md-${base}${occurrence ? `-${occurrence}` : ''}`;
      return `<h${token.depth} id="${escapeHtml(id)}">${inline}</h${token.depth}>\n`;
    },
  } });
  const metadata = frontmatter ? `<details class="markdown-metadata"><summary>YAML</summary><pre><code class="language-yaml">${escapeHtml(frontmatter[1])}</code></pre></details>\n` : '';
  return sanitizeHtml(metadata + parser.parse(body), {
    allowedTags: ['a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'strong', 'b', 'em', 'i', 's', 'del', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'span', 'div', 'input', 'kbd', 'sup', 'sub'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'], span: ['title'], code: ['class'], details: ['class'],
      h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
      ol: ['start'], th: ['align'], td: ['align'], input: ['type', 'disabled', 'checked'],
    },
    allowedClasses: { code: [/^language-[\w-]+$/], details: ['markdown-metadata'] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => linkTag(attributes),
      img: (tagName, attributes) => linkTag(attributes, true),
      input: (tagName, attributes) => attributes.type === 'checkbox' ? { tagName: 'input', attribs: { type: 'checkbox', disabled: '', ...(Object.hasOwn(attributes, 'checked') ? { checked: '' } : {}) } } : { tagName: 'span', attribs: {} },
      ...Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tagName => [tagName, (name, attributes) => ({ tagName: name, attribs: /^md-[\p{L}\p{N}_-]+$/u.test(attributes.id ?? '') ? { id: attributes.id } : {} })])),
    },
  });
}
