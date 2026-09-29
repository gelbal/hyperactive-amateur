// ABOUTME: Owns decoded Mood poster images and explicit URL-keyed eviction.
// ABOUTME: Keeps renderer image resources releasable from store take lifecycle paths.
export interface MoodPosterCacheEntry {
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
}

const posterCache = new Map<string, MoodPosterCacheEntry>();

export function getMoodPosterImage(posterUrl: string): MoodPosterCacheEntry {
  const cached = posterCache.get(posterUrl);
  if (cached) return cached;

  const image = new Image();
  const entry: MoodPosterCacheEntry = {
    image,
    ready: false,
    failed: false,
  };
  image.onload = () => {
    entry.ready = true;
    entry.failed = false;
  };
  image.onerror = () => {
    entry.ready = false;
    entry.failed = true;
  };
  image.src = posterUrl;
  posterCache.set(posterUrl, entry);
  return entry;
}

export function evictMoodPosters(
  posterUrls: Iterable<string | null | undefined>,
): void {
  for (const posterUrl of posterUrls) {
    if (!posterUrl) continue;
    const entry = posterCache.get(posterUrl);
    if (!entry) continue;
    entry.image.onload = null;
    entry.image.onerror = null;
    posterCache.delete(posterUrl);
  }
}

export function clearMoodPosterCache(): void {
  evictMoodPosters(posterCache.keys());
}

export function __getMoodPosterCacheSizeForTesting(): number {
  return posterCache.size;
}
