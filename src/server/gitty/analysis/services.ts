// Known libraries that mean "this code talks to a database / external service".
// A DATABASE or EXTERNAL_SERVICE node exists only when a file imports one of
// these, so the graph never shows a service the code does not use.

export type Ecosystem = "js" | "py" | "go" | "rust" | "jvm" | "ruby" | "php";

export interface ServiceEntry {
  id: string;
  label: string;
  kind: "DATABASE" | "EXTERNAL_SERVICE";
  imports: Partial<Record<Ecosystem, string[]>>;
}

const SERVICE_CATALOG: ServiceEntry[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    kind: "DATABASE",
    imports: {
      js: ["pg", "postgres", "@neondatabase/serverless", "@vercel/postgres"],
      py: ["psycopg2", "psycopg", "asyncpg"],
      go: ["github.com/lib/pq", "github.com/jackc/pgx"],
      rust: ["tokio_postgres", "postgres"],
      jvm: ["org.postgresql"],
      ruby: ["pg"],
    },
  },
  {
    id: "mysql",
    label: "MySQL",
    kind: "DATABASE",
    imports: {
      js: ["mysql", "mysql2", "@planetscale/database"],
      py: ["pymysql", "mysql", "MySQLdb", "aiomysql"],
      go: ["github.com/go-sql-driver/mysql"],
      rust: ["mysql", "mysql_async"],
      ruby: ["mysql2"],
    },
  },
  {
    id: "sqlite",
    label: "SQLite",
    kind: "DATABASE",
    imports: {
      js: ["better-sqlite3", "sqlite3", "sqlite", "@libsql/client"],
      py: ["sqlite3", "aiosqlite"],
      go: ["github.com/mattn/go-sqlite3", "modernc.org/sqlite"],
      rust: ["rusqlite"],
      ruby: ["sqlite3"],
    },
  },
  {
    id: "mongodb",
    label: "MongoDB",
    kind: "DATABASE",
    imports: {
      js: ["mongodb", "mongoose"],
      py: ["pymongo", "motor", "mongoengine", "beanie"],
      go: ["go.mongodb.org/mongo-driver"],
      rust: ["mongodb"],
      jvm: ["org.springframework.data.mongodb", "com.mongodb"],
      ruby: ["mongoid", "mongo"],
    },
  },
  {
    id: "redis",
    label: "Redis",
    kind: "DATABASE",
    imports: {
      js: ["redis", "ioredis", "@upstash/redis", "@vercel/kv"],
      py: ["redis", "aioredis"],
      go: ["github.com/redis/go-redis", "github.com/go-redis/redis"],
      rust: ["redis"],
      jvm: ["redis.clients.jedis", "io.lettuce"],
      ruby: ["redis"],
    },
  },
  {
    id: "orm-prisma",
    label: "Prisma ORM",
    kind: "DATABASE",
    imports: { js: ["@prisma/client"] },
  },
  {
    id: "orm-drizzle",
    label: "Drizzle ORM",
    kind: "DATABASE",
    imports: { js: ["drizzle-orm"] },
  },
  {
    id: "orm-sql",
    label: "SQL ORM",
    kind: "DATABASE",
    imports: {
      js: ["typeorm", "sequelize", "knex", "kysely", "@mikro-orm/core"],
      py: ["sqlalchemy", "sqlmodel", "peewee", "tortoise", "django.db"],
      go: ["gorm.io/gorm", "github.com/jmoiron/sqlx", "entgo.io/ent"],
      rust: ["sqlx", "diesel", "sea_orm"],
      jvm: [
        "javax.persistence",
        "jakarta.persistence",
        "org.hibernate",
        "org.springframework.data.jpa",
        "java.sql",
      ],
      ruby: ["active_record", "activerecord", "sequel"],
    },
  },
  {
    id: "elasticsearch",
    label: "Elasticsearch",
    kind: "DATABASE",
    imports: {
      js: ["@elastic/elasticsearch"],
      py: ["elasticsearch"],
      go: ["github.com/elastic/go-elasticsearch"],
    },
  },
  {
    id: "vector-db",
    label: "Vector database",
    kind: "DATABASE",
    imports: {
      js: [
        "@pinecone-database/pinecone",
        "@qdrant/js-client-rest",
        "weaviate-ts-client",
        "chromadb",
      ],
      py: ["pinecone", "qdrant_client", "weaviate", "chromadb", "pgvector"],
    },
  },
  {
    id: "firebase",
    label: "Firebase",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["firebase", "firebase-admin"],
      py: ["firebase_admin"],
    },
  },
  {
    id: "supabase",
    label: "Supabase",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@supabase/supabase-js", "@supabase/ssr"],
      py: ["supabase"],
    },
  },
  {
    id: "openai",
    label: "OpenAI API",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["openai", "@ai-sdk/openai"],
      py: ["openai"],
      go: ["github.com/sashabaranov/go-openai", "github.com/openai/openai-go"],
      rust: ["async_openai"],
    },
  },
  {
    id: "anthropic",
    label: "Anthropic API",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@anthropic-ai/sdk", "@ai-sdk/anthropic"],
      py: ["anthropic"],
    },
  },
  {
    id: "google-ai",
    label: "Google AI",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@google/genai", "@google/generative-ai", "@ai-sdk/google"],
      py: ["google.generativeai", "google.genai"],
    },
  },
  {
    id: "llm-frameworks",
    label: "LLM framework",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["langchain", "@langchain/core", "@langchain/openai", "ai"],
      py: ["langchain", "langchain_core", "llama_index", "litellm"],
    },
  },
  {
    id: "stripe",
    label: "Stripe",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["stripe", "@stripe/stripe-js"],
      py: ["stripe"],
      go: ["github.com/stripe/stripe-go"],
      ruby: ["stripe"],
    },
  },
  {
    id: "aws",
    label: "AWS",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["aws-sdk", "@aws-sdk"],
      py: ["boto3", "botocore", "aioboto3"],
      go: ["github.com/aws/aws-sdk-go", "github.com/aws/aws-sdk-go-v2"],
      rust: ["aws_sdk_s3", "aws_config"],
      jvm: ["software.amazon.awssdk", "com.amazonaws"],
    },
  },
  {
    id: "gcp",
    label: "Google Cloud",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@google-cloud"],
      py: ["google.cloud"],
      go: ["cloud.google.com/go"],
    },
  },
  {
    id: "github-api",
    label: "GitHub API",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@octokit", "octokit"],
      py: ["github", "githubkit"],
      go: ["github.com/google/go-github"],
    },
  },
  {
    id: "auth",
    label: "Auth provider",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@clerk", "next-auth", "@auth", "@kinde-oss", "@workos-inc"],
      py: ["authlib"],
    },
  },
  {
    id: "email",
    label: "Email service",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["resend", "@sendgrid/mail", "nodemailer", "postmark"],
      py: ["sendgrid", "resend"],
    },
  },
  {
    id: "twilio",
    label: "Twilio",
    kind: "EXTERNAL_SERVICE",
    imports: { js: ["twilio"], py: ["twilio"] },
  },
  {
    id: "monitoring",
    label: "Error monitoring",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@sentry"],
      py: ["sentry_sdk"],
      go: ["github.com/getsentry"],
    },
  },
  {
    id: "analytics",
    label: "Product analytics",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["posthog-js", "posthog-node", "@vercel/analytics", "mixpanel"],
      py: ["posthog", "mixpanel"],
    },
  },
  {
    id: "queue",
    label: "Message queue",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["bullmq", "bull", "kafkajs", "amqplib", "@upstash/qstash"],
      py: ["celery", "kombu", "pika", "kafka", "aiokafka", "rq", "dramatiq"],
      go: ["github.com/segmentio/kafka-go", "github.com/rabbitmq/amqp091-go"],
      ruby: ["sidekiq"],
    },
  },
  {
    id: "slack",
    label: "Slack",
    kind: "EXTERNAL_SERVICE",
    imports: { js: ["@slack"], py: ["slack_sdk", "slack_bolt"] },
  },
  {
    id: "discord",
    label: "Discord",
    kind: "EXTERNAL_SERVICE",
    imports: { js: ["discord.js"], py: ["discord"] },
  },
  {
    id: "object-storage",
    label: "Object storage",
    kind: "EXTERNAL_SERVICE",
    imports: {
      js: ["@vercel/blob", "cloudinary", "uploadthing"],
      py: ["cloudinary", "minio"],
    },
  },
];

const SEPARATOR: Record<Ecosystem, string> = {
  js: "/",
  go: "/",
  py: ".",
  jvm: ".",
  rust: "::",
  ruby: "/",
  php: "\\",
};

/** The catalog entry an import specifier belongs to, if any. */
export function matchService(
  ecosystem: Ecosystem,
  specifier: string,
): ServiceEntry | undefined {
  const separator = SEPARATOR[ecosystem];
  return SERVICE_CATALOG.find((entry) =>
    (entry.imports[ecosystem] ?? []).some(
      (name) => specifier === name || specifier.startsWith(name + separator),
    ),
  );
}
