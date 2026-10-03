import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Download,
  FileCode2,
  GitBranch,
  KeyRound,
  Lock,
  MousePointerClick,
  Network,
  Plus,
} from "lucide-react";

import { exampleRepos } from "~/lib/exampleRepos";
import { GITHUB_REPO_URL } from "~/lib/site";
import { cn } from "~/lib/utils";

const marqueeItems = [
  "Interactive diagrams",
  "Click through to source",
  "Trace any feature",
  "Ask Gemma about any file",
  "Export PNG & Mermaid",
  "Private repositories",
  "Built for AI agents",
  "Free & open source",
];

const stats = [
  { value: "$0", label: "Free to use, no account needed" },
  { value: "1", label: "URL change: github → gitdiagram" },
  { value: "2", label: "Export formats: PNG and Mermaid" },
  { value: "100%", label: "Open source on GitHub" },
];

const steps = [
  {
    number: "01",
    title: "Paste a repository",
    body: "Enter owner/repo or any GitHub URL. Or replace “hub” with “diagram” in the address bar of any repository page.",
  },
  {
    number: "02",
    title: "AI reads the code",
    body: "GitDiagram reads the file tree, the README and key source files, then maps the components and how they connect.",
  },
  {
    number: "03",
    title: "Explore the diagram",
    body: "Zoom and pan, click any component to jump to its source on GitHub, and export the result as PNG or Mermaid.",
  },
];

const features = [
  {
    icon: Network,
    tag: "Core",
    title: "Interactive architecture diagrams",
    body: "A clear map of any codebase: services, modules and the connections between them, drawn in seconds.",
    highlight: true,
  },
  {
    icon: MousePointerClick,
    tag: "New",
    title: "Explore with Gitty",
    body: "Click into any module, file or function, trace a feature end to end, see what breaks if it changes, and ask Gemma. Answers cite the exact lines.",
  },
  {
    icon: Download,
    title: "Export PNG & Mermaid",
    body: "Drop the diagram into docs, slides or a pull request, or keep editing the Mermaid source yourself.",
  },
  {
    icon: Lock,
    title: "Private repositories",
    body: "Use your own GitHub token for private code. The token stays in a secure cookie and is never saved on our servers.",
  },
  {
    icon: Bot,
    title: "Built for AI agents",
    body: "Every diagram is also Markdown at /owner/repo.md, and an MCP server lets assistants look up diagrams directly.",
  },
  {
    icon: KeyRound,
    title: "Bring your own key",
    body: "Add your own OpenAI API key for unlimited generations on your account, whenever you need more.",
  },
];

const useCases = [
  {
    icon: GitBranch,
    title: "Onboarding",
    body: "Understand a new codebase on day one instead of week three.",
  },
  {
    icon: FileCode2,
    title: "Open-source contributing",
    body: "See how a project fits together before you open your first pull request.",
  },
  {
    icon: Network,
    title: "System design study",
    body: "Learn real architecture from production projects like FastAPI and Flask.",
  },
  {
    icon: Download,
    title: "Docs & reviews",
    body: "Export an up-to-date diagram for design docs, READMEs and architecture reviews.",
  },
];

const exampleDescriptions: Record<string, string> = {
  FastAPI: "Modern, high-performance Python web framework.",
  GitDiagram: "This project: Next.js, AI generation and Mermaid rendering.",
  Flask: "The lightweight WSGI micro-framework for Python.",
  Monkeytype: "A minimalist, customizable typing test.",
};

const faqs = [
  {
    question: "Is GitDiagram free?",
    answer:
      "Yes. Generating and viewing diagrams of public repositories is free and needs no account. You can add your own API key if you want to generate more.",
  },
  {
    question: "Does it work with private repositories?",
    answer:
      "Yes. Open Private Repos in the navigation and paste a fine-grained GitHub token that can read the repository. The token is sent with each request and never stored on our servers.",
  },
  {
    question: "What is the fastest way to open a diagram?",
    answer:
      "Replace “hub” with “diagram” in any GitHub URL. github.com/owner/repo becomes the same path on GitDiagram and opens that repository’s diagram.",
  },
  {
    question: "Can I edit or export the diagram?",
    answer:
      "You can export it as a PNG image or copy the Mermaid source, then edit it in any Mermaid-compatible tool or paste it straight into Markdown.",
  },
  {
    question: "Can AI assistants use it?",
    answer:
      "Yes. Each repository’s diagram is available as Markdown at /owner/repo.md, and the MCP server at /mcp lets assistants like Claude and ChatGPT find and open diagrams.",
  },
];

function SectionHeading({
  label,
  title,
  highlight,
  subtitle,
  className,
}: {
  label: string;
  title: string;
  highlight: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <span className="label-chip">{label}</span>
      <h2 className="mt-5 text-[clamp(2rem,6vw,3.5rem)] leading-[1.02] tracking-tight">
        {title}{" "}
        <span className="headline-highlight inline-block">{highlight}</span>
      </h2>
      {subtitle ? (
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-600 sm:text-lg">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function Marquee() {
  const items = [...marqueeItems, ...marqueeItems];
  return (
    <div className="marquee" aria-label={marqueeItems.join(", ")}>
      <div className="marquee-track" aria-hidden="true">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className="marquee-item">
            {item}
            <span className="marquee-star">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function HomeSections() {
  return (
    <div className="mt-20 space-y-24 sm:mt-28 sm:space-y-32">
      <Marquee />

      <section aria-label="GitDiagram at a glance" className="home-container">
        <div className="border-ink grid grid-cols-2 border-[3px] bg-white shadow-[8px_8px_0_0_#0a0a0a] lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                "p-6 sm:p-8",
                index % 2 === 0 && "border-ink border-r-[3px]",
                index < 2 && "border-ink border-b-[3px] lg:border-b-0",
                index === 1 && "lg:border-r-[3px]",
                index === 2 && "lg:border-r-[3px]",
              )}
            >
              <p className="font-archivo text-4xl tracking-tight sm:text-5xl">
                {stat.value}
              </p>
              <p className="mt-2 text-sm leading-snug text-neutral-600">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="home-container scroll-mt-28">
        <SectionHeading
          label="How it works"
          title="From repo to"
          highlight="diagram"
          subtitle="Three steps, no setup. GitDiagram does the reading so you can get straight to understanding."
        />
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <li key={step.number} className="neo-panel card-lift relative p-7">
              <span className="font-archivo text-6xl leading-none text-transparent [-webkit-text-stroke:2px_#0a0a0a]">
                {step.number}
              </span>
              <h3 className="font-archivo mt-6 text-xl tracking-tight uppercase">
                {step.title}
              </h3>
              <p className="mt-3 leading-relaxed text-neutral-600">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" className="home-container scroll-mt-28">
        <SectionHeading
          label="Features"
          title="Everything you need to"
          highlight="read code fast"
          subtitle="Built for engineers who need to understand unfamiliar code quickly, and for the AI tools they work with."
        />
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className={cn(
                  "neo-panel card-lift relative flex flex-col p-7",
                  feature.highlight && "card-lime",
                )}
              >
                {feature.tag ? (
                  <span className="card-tag">{feature.tag}</span>
                ) : null}
                <span className="icon-box">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="font-archivo mt-6 text-lg leading-tight tracking-tight uppercase">
                  {feature.title}
                </h3>
                <p
                  className={cn(
                    "mt-3 leading-relaxed",
                    feature.highlight ? "text-ink/80" : "text-neutral-600",
                  )}
                >
                  {feature.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="use-cases" className="home-container scroll-mt-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-start">
          <SectionHeading
            label="Use cases"
            title="Made for how"
            highlight="you work"
            subtitle="Whether you are joining a team, reviewing a dependency or teaching system design, a diagram gets everyone on the same page."
            className="lg:sticky lg:top-32"
          />
          <div className="grid gap-6 sm:grid-cols-2">
            {useCases.map((useCase, index) => {
              const Icon = useCase.icon;
              return (
                <article
                  key={useCase.title}
                  className={cn(
                    "neo-panel card-lift p-6",
                    index === 1 && "card-sky",
                  )}
                >
                  <span className="icon-box">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-archivo mt-5 text-lg tracking-tight uppercase">
                    {useCase.title}
                  </h3>
                  <p className="mt-2 leading-relaxed text-neutral-700">
                    {useCase.body}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="examples" className="home-container scroll-mt-28">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            label="Examples"
            title="See it on"
            highlight="real repos"
          />
          <Link
            href="/browse"
            className="browse-muted-button inline-flex h-12 shrink-0 items-center gap-2 self-start px-5 text-sm font-semibold md:self-auto"
          >
            Browse all diagrams
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(exampleRepos).map(([name, path], index) => (
            <Link
              key={name}
              href={path}
              className={cn(
                "neo-panel card-lift group flex min-h-56 flex-col p-6",
                index === 0 && "card-lime",
              )}
            >
              <span className="meta-label">{path.slice(1)}</span>
              <h3 className="font-archivo mt-3 text-2xl tracking-tight uppercase">
                {name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                {exampleDescriptions[name]}
              </p>
              <span className="border-ink/15 font-archivo mt-auto flex items-center gap-2 border-t-2 pt-4 text-xs tracking-[0.12em] uppercase">
                Open diagram
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section id="faq" className="home-container scroll-mt-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <SectionHeading
            label="FAQ"
            title="Questions,"
            highlight="answered"
            subtitle="Anything else? Open an issue on GitHub or visit the support page."
          />
          <div className="space-y-5">
            {faqs.map((faq) => (
              <details key={faq.question} className="faq-item group">
                <summary className="faq-summary">
                  <span>{faq.question}</span>
                  <Plus
                    className="h-5 w-5 shrink-0 transition-transform duration-200 group-open:rotate-45"
                    aria-hidden="true"
                  />
                </summary>
                <p className="px-6 pb-6 leading-relaxed text-neutral-600">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="home-container">
        <div className="cta-band relative overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
          <span className="label-chip">Get started</span>
          <h2 className="mx-auto mt-6 max-w-3xl text-[clamp(2rem,6vw,4rem)] leading-[1.02] tracking-tight text-white">
            Map your next{" "}
            <span className="bg-lime text-ink inline-block px-[0.18em]">
              codebase
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-neutral-300 sm:text-lg">
            Paste a repository and get an interactive diagram in seconds. Free,
            open source, no sign-up.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="#generate"
              className="neo-button inline-flex h-12 items-center gap-2 px-6 text-sm"
            >
              Generate a diagram
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-archivo hover:text-ink inline-flex h-12 items-center gap-2 border-[3px] border-white px-6 text-sm tracking-[0.02em] text-white uppercase transition-colors hover:bg-white"
            >
              Star on GitHub
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
