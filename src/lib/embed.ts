function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the bare target of a wiki link: `[[a.png]]` -> `a.png`, `[[a.png|200]]` -> `a.png`.
 * Returns null for non-wiki forms such as markdown links `[a](path)`.
 */
export function wikiLinkTarget(link: string): string | null {
  const match = /^\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/.exec(link);
  return match ? match[1] : null;
}

/**
 * Locate the full `[[...]]` span whose target is `target`. The exact `indexOf` fast path
 * keeps prior behaviour for plain links; the regex fallback tolerates `|params` appended by
 * other plugins (e.g. DragImageAutoArrange embeds `[[a.png|orig|center|144|100]]`, whose
 * parser strips `|[^]]*(?=\]\])`). The optional `|...` group keeps `a.png` from matching
 * `a.pngx.png`. Returns null when absent.
 */
export function findWikiLink(content: string, target: string): { start: number; end: number } | null {
  if (target === "") {
    return null;
  }
  const exact = content.indexOf(`[[${target}]]`);
  if (exact !== -1) {
    return { start: exact, end: exact + target.length + 4 };
  }
  const pattern = new RegExp(`\\[\\[${escapeRegExp(target)}(?:\\|[^\\]]*)?\\]\\]`);
  const match = pattern.exec(content);
  if (match === null || match.index === undefined) {
    return null;
  }
  return { start: match.index, end: match.index + match[0].length };
}

/** Rewrite plan for a single link occurrence: replace `[from, to)` with `text`. */
export interface LinkRewrite {
  from: number;
  to: number;
  text: string;
  /** The matched link carried a `|params` annotation that this rewrite left in place. */
  annotationPreserved: boolean;
}

/**
 * Plan rewriting the link targeting `oldLink` into `newLink`.
 * Both wiki forms: only the target segment is swapped, so `![[`, `|params` and `]]` survive.
 * Otherwise: whole-span replacement, preserving the pre-existing markdown-link behaviour.
 * Only the first occurrence is rewritten, matching the old `indexOf` / `replace(string)`.
 */
export function planLinkRewrite(content: string, oldLink: string, newLink: string): LinkRewrite | null {
  const oldTarget = wikiLinkTarget(oldLink);
  const newTarget = wikiLinkTarget(newLink);
  if (oldTarget !== null && newTarget !== null) {
    const span = findWikiLink(content, oldTarget);
    if (span === null) {
      return null;
    }
    const from = span.start + 2;
    return {
      from: from,
      to: from + oldTarget.length,
      text: newTarget,
      annotationPreserved: span.end - span.start > oldTarget.length + 4,
    };
  }
  const index = content.indexOf(oldLink);
  if (index === -1) {
    return null;
  }
  return { from: index, to: index + oldLink.length, text: newLink, annotationPreserved: false };
}
