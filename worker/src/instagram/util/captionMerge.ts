export function mergeCaption(caption: string, hashtags: string[]) {
  const baseCaption = caption.trim();
  const cleanedTags = hashtags.map((t) => t.trim()).filter(Boolean);
  const maxLength = 2200;

  if (cleanedTags.length === 0) {
    return { mergedCaption: baseCaption.slice(0, maxLength), mergedHashtags: [] };
  }

  if (!baseCaption) {
    const mergedTags = fitHashtags(cleanedTags, maxLength);
    return {
      mergedCaption: mergedTags.join(" ").slice(0, maxLength),
      mergedHashtags: mergedTags,
    };
  }

  const mergedTags = fitHashtags(cleanedTags, maxLength - baseCaption.length - 2);
  const tagString = mergedTags.join(" ");
  const mergedCaption = tagString ? `${baseCaption}\n\n${tagString}` : baseCaption;

  return { mergedCaption: mergedCaption.slice(0, maxLength), mergedHashtags: mergedTags };
}

function fitHashtags(tags: string[], available: number): string[] {
  if (available <= 0) return [];
  const picked: string[] = [];
  let remaining = available;
  for (const tag of tags) {
    const nextLength = picked.length === 0 ? tag.length : tag.length + 1;
    if (nextLength > remaining) break;
    picked.push(tag);
    remaining -= nextLength;
  }
  return picked;
}
