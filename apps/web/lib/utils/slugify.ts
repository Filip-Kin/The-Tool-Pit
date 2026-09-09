export function slugify(text: string): string {
  return text
    
    // "Fikret Yüksel" slugs as fikret-yuksel, not fikret-yksel: strip the accents, keep the letters.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
