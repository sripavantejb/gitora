import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ExploreClient from "~/components/gitty/explore-client";
import { isDiagramGeneratorConfigured } from "~/server/readiness";

export const dynamic = "force-dynamic";

type ExplorePageProps = {
  params: Promise<{ username: string; repo: string }>;
};

const OWNER = /^[A-Za-z0-9-_]{1,100}$/;
const REPO = /^[A-Za-z0-9-_.]{1,100}$/;

export async function generateMetadata({ params }: ExplorePageProps): Promise<Metadata> {
  const { username, repo } = await params;
  return {
    title: `Explore ${username}/${repo} · Gitty`,
    description: `Understand the ${username}/${repo} codebase: an interactive map of its modules, files and functions, with answers grounded in the source.`,
    robots: { index: false },
  };
}

export default async function ExplorePage({ params }: ExplorePageProps) {
  const { username, repo } = await params;
  if (!OWNER.test(username) || !REPO.test(repo)) notFound();
  return (
    <ExploreClient owner={username} repo={repo} diagramsEnabled={isDiagramGeneratorConfigured()} />
  );
}
