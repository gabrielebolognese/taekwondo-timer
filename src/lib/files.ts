/** Hands a file to the iOS share sheet (Save to Files, AirDrop, Mail). Desktop browsers download it. */
export function shareOrDownload(file: File, title: string) {
  // On the phone the share sheet is the reliable way out of a home screen app.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title }).catch((e: Error) => {
      if (e.name !== 'AbortError') download(file);
    });
    return;
  }
  download(file);
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
