import Link from "next/link";

import { GitHubIcon } from "~/components/icons/github-icon";
import { GITHUB_REPO_URL } from "~/lib/site";
import { VIDEOS_ENABLED } from "~/lib/video-flag";

const productLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/browse", label: "Browse diagrams" },
  { href: "/#faq", label: "FAQ" },
  ...(VIDEOS_ENABLED ? [{ href: "/videos", label: "Explainer videos" }] : []),
  { href: "/visualize-codebase", label: "Visualize a codebase" },
];

const companyLinks = [
  { href: "/support", label: "Support" },
  { href: "/advertise", label: "Advertise" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="font-tagline mb-4 text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase">
        {title}
      </p>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="footer-link">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto px-3 pt-16 pb-6 sm:px-6">
      <div className="footer-shell mx-auto max-w-6xl rounded-xl px-6 py-10 sm:px-10">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="max-w-sm">
            <p className="font-archivo text-2xl tracking-tight uppercase">
              <span className="text-paper">Git</span>
              <span className="text-lime">Diagram</span>
            </p>
            <p className="font-tagline mt-3 text-sm leading-relaxed text-neutral-400">
              Turn any GitHub repository into an interactive architecture
              diagram in seconds. Free and open source.
            </p>
            <Link
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="browse-muted-button mt-6 inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold"
            >
              <GitHubIcon className="h-4 w-4" />
              Star on GitHub
            </Link>
          </div>
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t-2 border-white/10 pt-6 text-sm text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} GitDiagram. All rights reserved.</p>
          <p>
            Built by{" "}
            <Link
              href="https://github.com/sripavantejb"
              target="_blank"
              rel="noopener noreferrer"
              className="text-lime font-semibold hover:underline"
            >
              sripavantejb
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
