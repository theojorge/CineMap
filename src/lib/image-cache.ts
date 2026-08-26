const imageCache = new Map<string, HTMLImageElement>();

export function preloadImage(src: string): Promise<HTMLImageElement> {
  if (imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src)!);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}

export function getCachedImage(src: string): HTMLImageElement | undefined {
  return imageCache.get(src);
}

export function clearImageCache(): void {
  imageCache.clear();
}
