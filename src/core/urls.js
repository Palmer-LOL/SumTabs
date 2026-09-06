export function safeParseUrl(urlString) {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

export function isWebUrl(url) {
  return url?.protocol === "http:" || url?.protocol === "https:";
}
