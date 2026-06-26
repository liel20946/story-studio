/** Composite library key: site-slug--story-id */
export function parseCompositeStoryName(
  name: string,
): { siteSlug: string; storyId: string } | null {
  const idx = name.indexOf("--");
  if (idx <= 0 || idx >= name.length - 2) return null;
  return {
    siteSlug: name.slice(0, idx),
    storyId: name.slice(idx + 2),
  };
}
