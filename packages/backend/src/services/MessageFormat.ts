/** Strip tags for WhatsApp / plain-text channels. */
export function htmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'font',
]);

/**
 * Allow only a small formatting subset for owner-authored email HTML.
 * Strips scripts/events and unknown tags while keeping font/size/color styles.
 */
export function sanitizeMessageHtml(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  // Already plain text — escape and keep newlines.
  if (!/<[a-z][\s\S]*>/i.test(raw)) {
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  return raw
    .replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (_full, tag: string, attrs: string) => {
      const name = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      if (name === 'br') return '<br>';
      if (_full.startsWith('</')) return `</${name}>`;

      const safeAttrs: string[] = [];
      const styleMatch = attrs.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i);
      if (styleMatch) {
        const style = (styleMatch[2] || styleMatch[3] || '')
          .split(';')
          .map((part) => part.trim())
          .filter((part) => /^(color|font-family|font-size|font-weight|font-style|text-decoration)\s*:/i.test(part))
          .join('; ');
        if (style) safeAttrs.push(`style="${style.replace(/"/g, '')}"`);
      }
      const faceMatch = attrs.match(/face\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (faceMatch) {
        const face = (faceMatch[2] || faceMatch[3] || faceMatch[4] || '').replace(/["']/g, '');
        if (face) safeAttrs.push(`face="${face}"`);
      }
      const sizeMatch = attrs.match(/size\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (sizeMatch) {
        const size = (sizeMatch[2] || sizeMatch[3] || sizeMatch[4] || '').replace(/["']/g, '');
        if (/^[1-7]$/.test(size)) safeAttrs.push(`size="${size}"`);
      }
      const colorMatch = attrs.match(/color\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (colorMatch) {
        const color = (colorMatch[2] || colorMatch[3] || colorMatch[4] || '').replace(/["']/g, '');
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) || /^[a-z]+$/i.test(color)) {
          safeAttrs.push(`color="${color}"`);
        }
      }
      return `<${name}${safeAttrs.length ? ` ${safeAttrs.join(' ')}` : ''}>`;
    });
}

export function wrapEmailMessage(businessName: string, htmlBody: string, esc: (v: unknown) => string): string {
  const body = sanitizeMessageHtml(htmlBody);
  return `<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 600px; margin: 0 auto; color: #111827; line-height: 1.55;">
    <h2 style="margin: 0 0 12px; font-size: 20px;">${esc(businessName)}</h2>
    <div>${body}</div>
  </div>`;
}
