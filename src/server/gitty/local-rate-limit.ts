const localWindows = new Map<string, { start: number; count: number }>();
const MAX_LOCAL_BUCKETS = 10_000;

/** Per-instance limiter for deployments without Upstash; serverless instances each keep their own count. */
export function consumeLocalRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
  now = Date.now(),
) {
  const windowMs = windowSeconds * 1000;
  const start = now - (now % windowMs);
  const current = localWindows.get(key);
  if (!current || current.start !== start) {
    if (localWindows.size >= MAX_LOCAL_BUCKETS)
      for (const [bucket, entry] of localWindows)
        if (entry.start !== start) localWindows.delete(bucket);
    localWindows.set(key, { start, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= max,
    retryAfterSeconds: Math.ceil((start + windowMs - now) / 1000),
  };
}
