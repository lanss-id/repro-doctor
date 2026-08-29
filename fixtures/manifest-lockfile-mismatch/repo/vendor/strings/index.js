export function toTitleCase(value) {
  return value.replace(/\w\S*/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}
