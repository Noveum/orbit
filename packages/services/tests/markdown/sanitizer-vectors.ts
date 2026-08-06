export interface XssVector {
  readonly name: string;
  readonly source: string;
  readonly absent?: readonly string[];
  readonly present?: readonly string[];
  readonly parserDiverges?: true;
}

export const DANGEROUS = /javascript|vbscript|data:text\/html|\son[a-z]+=/i;

const TAG = /<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"]|"[^"]*")*)>/g;
const ATTRIBUTE = /[a-zA-Z-]+(?:="[^"]*")?/g;

export function canonicalHtml(html: string): string {
  return html.replace(TAG, (_match, tag: string, attributes: string) => {
    const parts = (attributes.match(ATTRIBUTE) ?? []).sort();
    return parts.length === 0 ? `<${tag}>` : `<${tag} ${parts.join(' ')}>`;
  });
}

const globals = globalThis as { HTMLRewriter?: unknown };
const bunRewriter = globals.HTMLRewriter;

export function withoutRewriter<T>(run: () => T): T {
  globals.HTMLRewriter = undefined;
  try {
    return run();
  } finally {
    globals.HTMLRewriter = bunRewriter;
  }
}

export function restoreRewriter(): void {
  globals.HTMLRewriter = bunRewriter;
}

export function rewriterAvailable(): boolean {
  return bunRewriter !== undefined;
}

export const XSS_VECTORS: readonly XssVector[] = [
  {
    name: 'script tag',
    source: 'hello <script>alert(1)</script> world',
    absent: ['<script', 'alert(1)'],
    present: ['hello'],
  },
  {
    name: 'script tag with trailing text',
    source: '<script>alert(1)</script>after',
    absent: ['alert(1)'],
    present: ['after'],
  },
  {
    name: 'img onerror',
    source: '<img src=x onerror="alert(1)">',
    absent: ['onerror', 'alert(1)'],
  },
  {
    name: 'img onerror unquoted after a textarea',
    source: '<textarea></textarea><img src=x onerror=alert(1)>after',
    absent: ['alert(1)', '<textarea'],
    present: ['after'],
  },
  {
    name: 'anchor javascript href',
    source: '<a href="javascript:alert(1)">click</a>',
    absent: ['javascript:'],
    present: ['click'],
  },
  {
    name: 'markdown link javascript payload',
    source: '[click](javascript:alert(document.cookie))',
    absent: ['javascript:', 'document.cookie'],
  },
  {
    name: 'iframe',
    source: '<iframe src="https://evil.example.com"></iframe>',
    absent: ['<iframe', 'evil.example.com'],
  },
  {
    name: 'iframe with trailing text',
    source: '<iframe src="https://evil.example"></iframe>after',
    absent: ['<iframe', 'evil.example'],
    present: ['after'],
  },
  {
    name: 'style attribute and svg onload',
    source: '<p style="background:url(javascript:alert(1))">x</p><svg onload="alert(1)"></svg>',
    absent: ['style=', '<svg', 'onload'],
  },
  {
    name: 'style element',
    source: '<style>body{background:url(javascript:alert(1))}</style>after',
    absent: ['<style', 'alert(1)'],
    present: ['after'],
  },
  {
    name: 'script inside a fenced code block',
    source: '```\n<script>alert(1)</script>\n```',
    absent: ['<script>'],
    present: ['&lt;script&gt;'],
  },
  {
    name: 'script hidden inside a disclosure',
    source: '<details><summary>x</summary><script>alert(1)</script></details>',
    absent: ['<script', 'alert(1)'],
    present: ['<details>', '<summary>x</summary>'],
  },
  {
    name: 'decimal entity scheme in a markdown link',
    source: '[a](&#106;avascript:alert(1))',
  },
  {
    name: 'hex entity scheme in a markdown link',
    source: '[a](&#x6a;avascript:alert(1))',
  },
  {
    name: 'entity encoded colon',
    source: '[a](javascript&#58;alert(1))',
  },
  {
    name: 'tab entity inside the scheme',
    source: '[a](java&Tab;script:alert(1))',
  },
  {
    name: 'fully entity encoded scheme',
    source: '[a](&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1))',
  },
  {
    name: 'entity encoded scheme in a markdown image',
    source: '![i](&#106;avascript:alert(1))',
  },
  {
    name: 'entity encoded scheme in a raw img src',
    source: '<img src="&#106;avascript:alert(1)">',
  },
  {
    name: 'anchor repeating href to smuggle a scheme',
    source: '<a href="https://ok.example" href="javascript:alert(1)">x</a>',
    present: ['href="https://ok.example"'],
  },
  {
    name: 'data text html href',
    source: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    absent: ['data:text/html'],
    present: ['x'],
  },
  {
    name: 'data text html in an iframe src',
    source: '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
    absent: ['<iframe', 'data:text/html'],
  },
  {
    name: 'object with a data url',
    source: '<object data="data:text/html,<script>alert(1)</script>"></object>after',
    absent: ['<object', 'data:text/html'],
    present: ['after'],
  },
  {
    name: 'embed',
    source: '<embed src="https://evil.example/x.swf">after',
    absent: ['<embed', 'evil.example'],
    present: ['after'],
  },
  {
    name: 'form with a formaction submit',
    source:
      '<form action="https://evil.example"><input type="submit" formaction="javascript:alert(1)"></form>after',
    absent: ['<form', 'formaction', 'evil.example'],
    present: ['after'],
  },
  {
    name: 'base tag rewriting relative urls',
    source: '<base href="https://evil.example/">after',
    absent: ['<base', 'evil.example'],
    present: ['after'],
  },
  {
    name: 'meta refresh',
    source: '<meta http-equiv="refresh" content="0;url=https://evil.example">after',
    absent: ['<meta', 'evil.example'],
    present: ['after'],
  },
  {
    name: 'link stylesheet',
    source: '<link rel="stylesheet" href="https://evil.example/x.css">after',
    absent: ['<link', 'evil.example'],
    present: ['after'],
  },
  {
    name: 'template smuggling a script',
    source: '<template><script>alert(1)</script></template>after',
    absent: ['<template', 'alert(1)'],
    present: ['after'],
  },
  {
    name: 'noscript escape',
    source: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">after</noscript>',
    absent: ['alert(1)', 'onerror'],
    parserDiverges: true,
  },
  {
    name: 'noembed escape',
    source: '<noembed><img src=x onerror=alert(1)></noembed>after',
    absent: ['alert(1)', 'onerror'],
    present: ['after'],
  },
  {
    name: 'xmp escape',
    source: '<xmp><img src=x onerror=alert(1)></xmp>after',
    absent: ['alert(1)', 'onerror'],
  },
  {
    name: 'plaintext escape',
    source: '<plaintext><img src=x onerror=alert(1)>',
    absent: ['alert(1)', 'onerror'],
    parserDiverges: true,
  },
  {
    name: 'title escape',
    source: '<title></title><img src=x onerror=alert(1)>',
    absent: ['alert(1)', 'onerror'],
  },
  {
    name: 'mxss through math mtext mglyph',
    source:
      '<math><mtext><mglyph><style><img src=x onerror=alert(1)></style></mglyph></mtext></math>',
    absent: ['<math', 'alert(1)', 'onerror'],
  },
  {
    name: 'svg foreignObject',
    source: '<svg><foreignObject><a href="javascript:alert(1)">x</a></foreignObject></svg>',
    absent: ['<svg', 'javascript:'],
  },
  {
    name: 'svg animate href',
    source:
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate></a></svg>',
    absent: ['<svg', 'javascript:'],
  },
  {
    name: 'canvas',
    source: '<canvas onclick="alert(1)">fallback</canvas>after',
    absent: ['<canvas', 'onclick', 'alert(1)'],
    present: ['after'],
  },
  {
    name: 'video with an onerror source',
    source: '<video><source src=x onerror=alert(1)></video>after',
    absent: ['<video', '<source', 'alert(1)'],
    present: ['after'],
  },
  {
    name: 'audio onerror',
    source: '<audio src=x onerror=alert(1)>after</audio>',
    absent: ['<audio', 'alert(1)', 'onerror'],
  },
  {
    name: 'dialog wrapper',
    source: '<dialog open onclose="alert(1)">hidden</dialog>after',
    absent: ['<dialog', 'onclose', 'alert(1)'],
    present: ['after'],
  },
  {
    name: 'applet',
    source: '<applet code="Evil.class"></applet>after',
    absent: ['<applet'],
    present: ['after'],
  },
  {
    name: 'frameset',
    source: '<frameset><frame src="javascript:alert(1)"></frameset>after',
    absent: ['<frameset', '<frame', 'javascript:'],
  },
  {
    name: 'unknown element unwrapped but its handler dropped',
    source: '<section onmouseover="alert(1)"><p>kept</p></section>',
    absent: ['onmouseover', 'alert(1)', '<section'],
    present: ['kept'],
  },
  {
    name: 'allowed element with a handler and an id',
    source: '<p onclick="steal()" id="x">text</p>',
    absent: ['onclick', 'steal()', 'id="x"'],
    present: ['text'],
  },
  {
    name: 'html comment hiding markup',
    source: '<!-- <script>alert(1)</script> --><p>visible</p>',
    absent: ['alert(1)', '<!--'],
    present: ['visible'],
  },
  {
    name: 'vbscript href',
    source: '<a href="vbscript:msgbox(1)">x</a>',
    absent: ['vbscript:'],
    present: ['x'],
  },
  {
    name: 'newline split scheme',
    source: '<a href="java\nscript:alert(1)">x</a>',
    absent: ['alert(1)'],
  },
  {
    name: 'uppercase script tag',
    source: '<SCRIPT>alert(1)</SCRIPT>after',
    absent: ['alert(1)'],
    present: ['after'],
  },
  {
    name: 'srcdoc on an iframe',
    source: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>after',
    absent: ['<iframe', 'srcdoc'],
    present: ['after'],
  },
];
