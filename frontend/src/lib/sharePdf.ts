type NativeFileShare = Navigator & {
  canShare?: (data: ShareData) => boolean;
};

export async function sharePdfFile(
  file: File,
  details: { title: string; text: string },
): Promise<boolean> {
  const nav = navigator as NativeFileShare;
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) return false;

  await nav.share({ ...details, files: [file] });
  return true;
}
