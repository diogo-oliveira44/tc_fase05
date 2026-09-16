const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const acceptedTypes = Object.keys(extensions);
export const isAccepted = (mime: string) => Object.hasOwn(extensions, mime);
export const extensionFor = (mime: string) => extensions[mime]!;
export const maxPerIncident = 5;
