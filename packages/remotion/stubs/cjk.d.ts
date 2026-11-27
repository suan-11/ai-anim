export function breakCaption(text: string, o?: { maxChars?: number; maxLines?: number }): {
  rows: string[]; overflow: boolean; widest: number;
};
