const BLOCK_CLOSERS = /<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi;

export function htmlToMarkdown(html: string | null | undefined): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img [^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)')
    .replace(/<img [^>]*src="([^"]*)"[^>]*>/gi, '![]($1)')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text) =>
      String(text).trim().length === 0 ? String(href) : `[${String(text).trim()}](${href})`,
    )
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<h[4-6][^>]*>/gi, '\n#### ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<blockquote[^>]*>/gi, '> ')
    .replace(/<(strong|b)>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)>/gi, '_')
    .replace(/<\/(em|i)>/gi, '_')
    .replace(/<code[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`')
    .replace(/<pre[^>]*>/gi, '\n```\n')
    .replace(/<\/pre>/gi, '\n```\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_CLOSERS, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
