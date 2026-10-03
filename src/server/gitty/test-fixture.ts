import type { GithubData, RepositoryPathType } from "~/server/generate/github";
import { createReferenceResolver } from "~/server/generate/source-references";

import { buildCodebaseGraph } from "./analysis/build-graph";
import type { LoadedRepository } from "./repository";

/** An analyzed repository built from in-memory files, for tests. */
export function fixtureRepository(
  files: Record<string, string>,
): LoadedRepository {
  const pathTypes = new Map<string, RepositoryPathType>();
  for (const path of Object.keys(files)) {
    pathTypes.set(path, "blob");
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++)
      pathTypes.set(segments.slice(0, index).join("/"), "tree");
  }
  const githubData: GithubData = {
    defaultBranch: "main",
    fileTree: Object.keys(files).join("\n"),
    readme: files["README.md"] ?? "",
    isPrivate: false,
    stargazerCount: 1,
    pathTypes,
  };
  const texts = new Map(
    Object.entries(files).filter(
      ([path]) => !/\.(?:md|env)$|^\.env/.test(path),
    ),
  );
  const resolve = createReferenceResolver(pathTypes);
  const references = new Map<string, string[]>();
  const importers = new Map<string, string[]>();
  for (const [path, text] of texts) {
    const targets = resolve(path, text);
    references.set(path, targets);
    for (const target of targets)
      importers.set(target, [...(importers.get(target) ?? []), path]);
  }
  const { graph, analyses } = buildCodebaseGraph({
    repository: {
      owner: "acme",
      repo: "shop",
      defaultBranch: "main",
      stars: 1,
      isPrivate: false,
      hasReadme: Boolean(files["README.md"]),
    },
    pathTypes,
    treeTruncated: false,
    texts,
    references,
    rankedPaths: [...texts.keys()],
  });
  return {
    owner: "acme",
    repo: "shop",
    githubData,
    graph,
    analyses,
    texts,
    references,
    importers,
    extraCharacters: 0,
  };
}

export const SHOP_FILES: Record<string, string> = {
  "README.md": "# Shop\nA tiny store.",
  "package.json": '{ "name": "shop" }',
  ".env": "SECRET=1",
  "src/app/checkout/page.tsx": `import { CheckoutForm } from "~/components/checkout-form";

export default function CheckoutPage() {
  return <CheckoutForm />;
}
`,
  "src/components/checkout-form.tsx": `"use client";
import { submitOrder } from "~/lib/orders";

export function CheckoutForm() {
  const onSubmit = () => submitOrder({ items: [] });
  return <form onSubmit={onSubmit} />;
}
`,
  "src/app/api/orders/route.ts": `import { createOrder } from "~/server/orders/service";

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(await createOrder(body));
}
`,
  "src/lib/orders.ts": `export async function submitOrder(order: unknown) {
  return fetch("/api/orders", { method: "POST", body: JSON.stringify(order) });
}
`,
  "src/server/orders/service.ts": `import { saveOrder } from "./repository";
import Stripe from "stripe";

export async function createOrder(order: unknown) {
  const stripe = new Stripe("key");
  await stripe.paymentIntents.create({ amount: 1, currency: "usd" });
  return saveOrder(order);
}
`,
  "src/server/orders/repository.ts": `import { db } from "~/server/db";

export function saveOrder(order: unknown) {
  return db.insert(order);
}
`,
  "src/server/db.ts": `import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const db = drizzle(new Pool());
`,
};
