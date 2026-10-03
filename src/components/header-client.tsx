"use client";

import { Suspense, use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { GitHubIcon } from "~/components/icons/github-icon";
import { useGitHubConnectResult } from "~/hooks/use-github-connect-result";
import { formatCompact } from "~/lib/format";
import { GITHUB_REPO_URL } from "~/lib/site";
import { cn } from "~/lib/utils";
import { VIDEOS_ENABLED } from "~/lib/video-flag";

import { NewBadge } from "./new-badge";

const loadApiKeyDialog = () =>
  import("./api-key-dialog").then((module) => module.ApiKeyDialog);
const loadPrivateReposDialog = () =>
  import("./private-repos-dialog").then((module) => module.PrivateReposDialog);

const ApiKeyDialog = dynamic(loadApiKeyDialog, { ssr: false });
const PrivateReposDialog = dynamic(loadPrivateReposDialog, { ssr: false });

interface HeaderClientProps {
  starCount: Promise<number | null>;
}

function formatStarCount(count: number) {
  return formatCompact(count).toLowerCase();
}

function StarCount({ starCount }: HeaderClientProps) {
  const count = use(starCount);
  if (count === null) return null;

  return (
    <span className="nav-cta-count">
      <span aria-hidden="true">★</span>
      {formatStarCount(count)}
    </span>
  );
}

function MobileMenuStarCount({ starCount }: HeaderClientProps) {
  const count = use(starCount);
  if (count === null) return null;

  return (
    <span className="text-xs tracking-[0.12em] text-[hsl(var(--neo-soft-text))] uppercase">
      ★ {formatStarCount(count)}
    </span>
  );
}

function Logo() {
  return (
    <Link href="/" aria-label="GitDiagram home" className="nav-logo">
      <span aria-hidden="true" className="nav-logo-mark">
        GD
      </span>
      <span className="font-archivo text-sm tracking-tight uppercase lg:hidden">
        GitDiagram
      </span>
    </Link>
  );
}

export function HeaderClient({ starCount }: HeaderClientProps) {
  const pathname = usePathname();
  const [isPrivateReposDialogOpen, setIsPrivateReposDialogOpen] =
    useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [connectResult, dismissConnectResult] = useGitHubConnectResult("menu");
  // Back from a GitHub sign-in started here: reopen the dialog, which shows
  // the connected account or why the sign-in did not finish.
  useEffect(() => {
    if (connectResult) setIsPrivateReposDialogOpen(true);
  }, [connectResult]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // pathname is identical on server and client for full-page loads (the proxy
  // never rewrites URLs), so these can render at SSR without mismatch risk.
  const isBrowsePage = pathname === "/browse";
  const isVideosPage = pathname === "/videos";

  return (
    <header className="sticky top-0 z-50 mb-6 flex justify-center px-3 pt-3 sm:mb-10 sm:pt-4">
      <div
        data-scrolled={isScrolled}
        className="nav-shell flex h-14 w-full max-w-3xl items-center justify-between gap-2 py-2 pr-2 pl-2 md:w-auto md:max-w-none md:gap-6"
      >
        <Logo />

        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 md:flex"
        >
          {VIDEOS_ENABLED && (
            <Link
              href="/videos"
              aria-current={isVideosPage ? "page" : undefined}
              className={cn("nav-pill", isVideosPage && "nav-pill-active")}
            >
              Videos
              <NewBadge />
            </Link>
          )}
          <Link href="/#how-it-works" className="nav-pill">
            How it works
          </Link>
          <Link href="/#features" className="nav-pill">
            Features
          </Link>
          <Link
            href="/browse"
            aria-current={isBrowsePage ? "page" : undefined}
            className={cn("nav-pill", isBrowsePage && "nav-pill-active")}
          >
            Browse
          </Link>
          <Link href="/#faq" className="nav-pill lg:inline-flex hidden">
            FAQ
          </Link>
          <button
            type="button"
            onFocus={() => void loadApiKeyDialog()}
            onPointerEnter={() => void loadApiKeyDialog()}
            onClick={() => setIsApiKeyDialogOpen(true)}
            className="nav-pill"
          >
            API Key
          </button>
          <button
            type="button"
            onFocus={() => void loadPrivateReposDialog()}
            onPointerEnter={() => void loadPrivateReposDialog()}
            onClick={() => setIsPrivateReposDialogOpen(true)}
            className="nav-pill"
          >
            Private Repos
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={GITHUB_REPO_URL}
            className="nav-cta"
          >
            <GitHubIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Star</span>
            <Suspense fallback={null}>
              <StarCount starCount={starCount} />
            </Suspense>
          </Link>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((currentValue) => !currentValue)}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-site-menu"
            aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
            className="nav-menu-button md:hidden"
          >
            {isMobileMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>

        <div
          data-state={isMobileMenuOpen ? "open" : "closed"}
          aria-hidden={!isMobileMenuOpen}
          className="mobile-menu-layer fixed inset-0 z-40 md:hidden"
        >
          <button
            type="button"
            aria-label="Close mobile menu"
            tabIndex={isMobileMenuOpen ? 0 : -1}
            onClick={() => setIsMobileMenuOpen(false)}
            className="mobile-menu-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="pointer-events-none absolute inset-x-3 top-[5.5rem] z-10 sm:inset-x-6">
            <div
              id="mobile-site-menu"
              inert={!isMobileMenuOpen}
              className="neo-panel mobile-menu-panel pointer-events-auto ml-auto w-full max-w-[20rem] rounded-lg p-3"
            >
              <p className="font-tagline px-1 pb-2 text-[11px] font-semibold tracking-[0.2em] text-[hsl(var(--neo-soft-text))] uppercase">
                Menu
              </p>
              <nav className="flex flex-col gap-2">
                {VIDEOS_ENABLED && (
                  <Link
                    href="/videos"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="neo-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm"
                  >
                    Videos
                    <NewBadge />
                  </Link>
                )}
                {[
                  { href: "/#how-it-works", label: "How it works" },
                  { href: "/#features", label: "Features" },
                  { href: "/#faq", label: "FAQ" },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between px-4 py-3 text-sm font-semibold"
                  >
                    {link.label}
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
                {!isBrowsePage ? (
                  <Link
                    href="/browse"
                    prefetch={false}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                  >
                    Browse
                    <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
                <button
                  type="button"
                  onFocus={() => void loadApiKeyDialog()}
                  onPointerEnter={() => void loadApiKeyDialog()}
                  onClick={() => {
                    setIsApiKeyDialogOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                >
                  API Key
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  type="button"
                  onFocus={() => void loadPrivateReposDialog()}
                  onPointerEnter={() => void loadPrivateReposDialog()}
                  onClick={() => {
                    setIsPrivateReposDialogOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                >
                  Private Repos
                  <span aria-hidden="true">→</span>
                </button>
                <Link
                  href={GITHUB_REPO_URL}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="browse-muted-button inline-flex min-h-[48px] items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-semibold"
                >
                  <span className="flex items-center gap-2">
                    <GitHubIcon className="h-5 w-5" />
                    GitHub Repo
                  </span>
                  <Suspense fallback={null}>
                    <MobileMenuStarCount starCount={starCount} />
                  </Suspense>
                </Link>
              </nav>
            </div>
          </div>
        </div>

        {isPrivateReposDialogOpen ? (
          <PrivateReposDialog
            isOpen
            source="menu"
            returnTo={pathname}
            connectError={
              connectResult?.status === "failed"
                ? connectResult.reason
                : undefined
            }
            onClose={() => {
              setIsPrivateReposDialogOpen(false);
              dismissConnectResult();
            }}
          />
        ) : null}
        {isApiKeyDialogOpen ? (
          <ApiKeyDialog isOpen onClose={() => setIsApiKeyDialogOpen(false)} />
        ) : null}
      </div>
    </header>
  );
}
