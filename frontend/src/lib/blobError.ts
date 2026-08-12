export async function apiErrorMessage(error: any, fallback: string): Promise<string> {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      if (!text) return fallback;
      try {
        const parsed = JSON.parse(text);
        return String(parsed?.error || parsed?.message || fallback);
      } catch {
        return text.slice(0, 500);
      }
    } catch {
      return fallback;
    }
  }
  return String(data?.error || data?.message || error?.message || fallback);
}
