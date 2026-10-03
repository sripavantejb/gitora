import {
  AppWindow,
  Box,
  Braces,
  Cloud,
  Database,
  FileCode2,
  Folder,
  FolderGit2,
  Package,
  Route,
  type LucideIcon,
} from "lucide-react";

import type { CodeNodeType } from "~/features/gitty/types";

export const NODE_ICONS: Record<CodeNodeType, LucideIcon> = {
  REPOSITORY: FolderGit2,
  APPLICATION: AppWindow,
  MODULE: Package,
  DIRECTORY: Folder,
  FILE: FileCode2,
  CLASS: Box,
  FUNCTION: Braces,
  API_ROUTE: Route,
  DATABASE: Database,
  EXTERNAL_SERVICE: Cloud,
};

/** Fill colour per node type, from the site palette. */
export const NODE_FILL: Record<CodeNodeType, string> = {
  REPOSITORY: "bg-ink text-lime",
  APPLICATION: "bg-purple text-ink",
  MODULE: "bg-sky text-ink",
  DIRECTORY: "bg-white text-ink",
  FILE: "bg-white text-ink",
  CLASS: "bg-[#ffe1d2] text-ink",
  FUNCTION: "bg-[#d9f8e9] text-ink",
  API_ROUTE: "bg-pink text-ink",
  DATABASE: "bg-sky text-ink",
  EXTERNAL_SERVICE: "bg-[#ffd8c2] text-ink",
};

export const NODE_TYPE_LABEL: Record<CodeNodeType, string> = {
  REPOSITORY: "Repository",
  APPLICATION: "Application",
  MODULE: "Module",
  DIRECTORY: "Directory",
  FILE: "File",
  CLASS: "Class",
  FUNCTION: "Function",
  API_ROUTE: "API route",
  DATABASE: "Database",
  EXTERNAL_SERVICE: "External service",
};
