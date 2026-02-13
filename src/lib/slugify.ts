export function slugify(name: string): string {
  if (/^[a-zA-Z0-9\s\-_.]+$/.test(name)) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[\s_.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  return encodeURIComponent(name);
}

export function deslugify(slug: string): string {
  return decodeURIComponent(slug);
}
