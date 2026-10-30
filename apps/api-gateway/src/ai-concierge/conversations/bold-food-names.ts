// Format known menu/profile names; preserve existing bold/code.
export function boldFoodNames(text: string, names: Iterable<string>): string {
  const choices = [...new Set(names)]
    .filter((n) => n.trim())
    .sort((a, b) => b.length - a.length);
  if (!choices.length) return text;
  const pattern = choices
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]*`)/g)
    .map((part, index) =>
      index % 2 ? part : part.replace(matcher, (name) => `**${name}**`),
    )
    .join("");
}
