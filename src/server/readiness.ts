import { getProvider } from "~/server/generate/model-config";
import { readRequiredEnv } from "~/server/storage/config";
import { checkR2Bucket } from "~/server/storage/r2";
import { checkUpstashConnection } from "~/server/storage/upstash";

export interface ReadinessResult {
  ok: boolean;
  checks: {
    configuration: boolean;
    provider: boolean;
    publicStorage: boolean;
    privateStorage: boolean;
    redis: boolean;
  };
}

function hasProviderKey(): boolean {
  const provider = getProvider();
  const keyName =
    provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  return Boolean(process.env[keyName]?.trim());
}

const DIAGRAM_STORAGE_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BUCKET",
  "R2_PRIVATE_BUCKET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "CACHE_KEY_SECRET",
] as const;

/** Whether the diagram generator has its storage and model credentials. */
export function isDiagramGeneratorConfigured(): boolean {
  return (
    hasProviderKey() &&
    DIAGRAM_STORAGE_ENV.every((name) => Boolean(process.env[name]?.trim()))
  );
}

export async function checkReadiness(): Promise<ReadinessResult> {
  let publicBucket = "";
  let privateBucket = "";
  let configuration = true;
  try {
    publicBucket = readRequiredEnv("R2_PUBLIC_BUCKET");
    privateBucket = readRequiredEnv("R2_PRIVATE_BUCKET");
    readRequiredEnv("R2_ACCOUNT_ID");
    readRequiredEnv("R2_ACCESS_KEY_ID");
    readRequiredEnv("R2_SECRET_ACCESS_KEY");
    readRequiredEnv("UPSTASH_REDIS_REST_URL");
    readRequiredEnv("UPSTASH_REDIS_REST_TOKEN");
    readRequiredEnv("CACHE_KEY_SECRET");
  } catch {
    configuration = false;
  }

  const provider = hasProviderKey();
  const [publicStorageResult, privateStorageResult, redisResult] = configuration
    ? await Promise.allSettled([
        checkR2Bucket(publicBucket),
        checkR2Bucket(privateBucket),
        checkUpstashConnection(),
      ])
    : [
        { status: "rejected" as const },
        { status: "rejected" as const },
        { status: "rejected" as const },
      ];

  const checks = {
    configuration,
    provider,
    publicStorage: publicStorageResult.status === "fulfilled",
    privateStorage: privateStorageResult.status === "fulfilled",
    redis: redisResult.status === "fulfilled",
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}
