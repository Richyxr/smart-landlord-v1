export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Returns initials for a given name string.
 * Single word (e.g., "Master") -> "MA"
 * Single letter (e.g., "M") -> "M"
 * Multi-word (e.g., "Richard Nzioka") -> "RN"
 * Fallback for empty/null/undefined -> "?"
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';

  if (words.length === 1) {
    const word = words[0];
    return word.length > 1 ? word.slice(0, 2).toUpperCase() : word.toUpperCase();
  }

  const firstInitial = words[0][0];
  const lastInitial = words[words.length - 1][0];
  return (firstInitial + lastInitial).toUpperCase();
}

