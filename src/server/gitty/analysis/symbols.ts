import type { Ecosystem } from "./services";

// Lightweight, deterministic extraction of the declarations a reader would
// look for first: top-level classes and functions and HTTP routes, each with
// the lines it spans. Regex-based on purpose: it runs on any language without
// a parser, and every result points at a real line of the file.

type SymbolKind = "class" | "function" | "route";

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based. */
  line: number;
  endLine: number;
  exported: boolean;
  /** "GET /api/users" for routes. */
  route?: string;
}

interface ExternalImport {
  specifier: string;
  line: number;
}

export interface FileAnalysis {
  ecosystem: Ecosystem | null;
  symbols: ExtractedSymbol[];
  imports: ExternalImport[];
}

const MAX_SYMBOLS_PER_FILE = 60;
const MAX_SPAN_LINES = 600;

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export function ecosystemOf(path: string): Ecosystem | null {
  if (/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(path)) return "js";
  if (/\.py$/i.test(path)) return "py";
  if (/\.go$/i.test(path)) return "go";
  if (/\.rs$/i.test(path)) return "rust";
  if (/\.(?:java|kts?|scala)$/i.test(path)) return "jvm";
  if (/\.rb$/i.test(path)) return "ruby";
  if (/\.php$/i.test(path)) return "php";
  return null;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** Where a brace-delimited declaration starting on `line` closes. */
function braceEnd(lines: string[], line: number): number {
  let depth = 0;
  let opened = false;
  const last = Math.min(lines.length, line + MAX_SPAN_LINES);
  for (let index = line - 1; index < last; index++) {
    const code = lines[index]!.replace(
      /(["'`])(?:\\.|(?!\1).)*\1/g,
      '""',
    ).replace(/\/\/.*$/, "");
    for (const char of code) {
      if (char === "{") {
        depth++;
        opened = true;
      } else if (char === "}") {
        depth--;
        if (opened && depth <= 0) return index + 1;
      }
    }
    // A one-line declaration without a body: `export const x = () => y;`
    if (!opened && index > line - 1 + 3) return line;
    if (!opened && /;\s*$/.test(code)) return index + 1;
  }
  return opened ? last : line;
}

/** Where an indentation-delimited declaration (Python, Ruby) ends. */
function indentEnd(lines: string[], line: number, includeEnd: boolean): number {
  const indent = /^\s*/.exec(lines[line - 1]!)![0].length;
  let end = line;
  const last = Math.min(lines.length, line + MAX_SPAN_LINES);
  for (let index = line; index < last; index++) {
    const text = lines[index]!;
    if (!text.trim()) continue;
    const current = /^\s*/.exec(text)![0].length;
    if (current <= indent) {
      if (includeEnd && /^\s*end\b/.test(text) && current === indent)
        return index + 1;
      if (/^\s*[)\]}]/.test(text) && current === indent) return index + 1;
      break;
    }
    end = index + 1;
  }
  return end;
}

/** The URL path a Next.js App Router route or Pages API file serves. */
export function nextRouteOf(path: string): string | null {
  const app = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]s$/.exec(path);
  if (app) {
    const segments = app[1]!
      .split("/")
      .filter(
        (segment) =>
          segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"),
      );
    return `/${segments.join("/")}`;
  }
  const pages = /(?:^|\/)pages\/(api\/.*?)\.[cm]?[jt]s$/.exec(path);
  if (pages) return `/${pages[1]!.replace(/\/index$/, "")}`;
  return null;
}

type Rule = {
  pattern: RegExp;
  kind: SymbolKind;
  /** Capture group holding the name. */
  name: number;
  exported?: (match: RegExpExecArray) => boolean;
};

const JS_RULES: Rule[] = [
  {
    pattern:
      /^[\t ]*(export[\t ]+(?:default[\t ]+)?)?(?:declare[\t ]+)?(?:abstract[\t ]+)?class[\t ]+([A-Za-z_$][\w$]*)/gm,
    kind: "class",
    name: 2,
    exported: (match) => Boolean(match[1]),
  },
  {
    pattern:
      /^[\t ]*(export[\t ]+(?:default[\t ]+)?)?(?:async[\t ]+)?function[\t ]*\*?[\t ]*([A-Za-z_$][\w$]*)/gm,
    kind: "function",
    name: 2,
    exported: (match) => Boolean(match[1]),
  },
  {
    pattern:
      /^(export[\t ]+)?(?:const|let)[\t ]+([A-Za-z_$][\w$]*)[\t ]*(?::[^=\n]{1,120})?=[\t ]*(?:async[\t ]+)?(?:function\b|\([^)\n]*\)[\t ]*(?::[^=\n]{1,80})?=>|[A-Za-z_$][\w$]*[\t ]*=>|(?:React\.)?(?:memo|forwardRef)\()/gm,
    kind: "function",
    name: 2,
    exported: (match) => Boolean(match[1]),
  },
];

const PY_RULES: Rule[] = [
  { pattern: /^class[\t ]+([A-Za-z_]\w*)/gm, kind: "class", name: 1 },
  {
    pattern: /^(?:async[\t ]+)?def[\t ]+([A-Za-z_]\w*)/gm,
    kind: "function",
    name: 1,
  },
  {
    pattern: /^[\t ]{4}(?:async[\t ]+)?def[\t ]+([A-Za-z_]\w*)/gm,
    kind: "function",
    name: 1,
  },
];

const GO_RULES: Rule[] = [
  {
    pattern: /^type[\t ]+([A-Za-z_]\w*)[\t ]+(?:struct|interface)\b/gm,
    kind: "class",
    name: 1,
    exported: (match) => /^[A-Z]/.test(match[1]!),
  },
  {
    pattern: /^func[\t ]+(?:\([^)]*\)[\t ]*)?([A-Za-z_]\w*)/gm,
    kind: "function",
    name: 1,
    exported: (match) => /^[A-Z]/.test(match[1]!),
  },
];

const RUST_RULES: Rule[] = [
  {
    pattern:
      /^[\t ]*(pub(?:\([^)]*\))?[\t ]+)?(?:struct|enum|trait)[\t ]+([A-Za-z_]\w*)/gm,
    kind: "class",
    name: 2,
    exported: (match) => Boolean(match[1]),
  },
  {
    pattern:
      /^[\t ]*(pub(?:\([^)]*\))?[\t ]+)?(?:const[\t ]+)?(?:async[\t ]+)?(?:unsafe[\t ]+)?fn[\t ]+([A-Za-z_]\w*)/gm,
    kind: "function",
    name: 2,
    exported: (match) => Boolean(match[1]),
  },
];

const JVM_RULES: Rule[] = [
  {
    pattern:
      /^[\t ]*((?:public|internal|open|data|sealed|abstract|final|static|private|protected|enum|annotation)[\t ]+)*(?:class|interface|object|record|enum)[\t ]+([A-Z]\w*)/gm,
    kind: "class",
    name: 2,
    exported: (match) => !/private/.test(match[0]),
  },
  {
    pattern:
      /^[\t ]*(?:(?:public|private|protected|internal|override|suspend|open|inline|static|final|synchronized|abstract)[\t ]+)*fun[\t ]+(?:<[^>]*>[\t ]*)?(?:[\w.]+\.)?([a-zA-Z_]\w*)/gm,
    kind: "function",
    name: 1,
    exported: (match) => !/private/.test(match[0]),
  },
  {
    pattern:
      /^[\t ]*(?:public|protected)[\t ]+(?:(?:static|final|synchronized|abstract)[\t ]+)*(?:<[^>]*>[\t ]+)?[\w<>[\],.?]+[\t ]+([a-z_]\w*)[\t ]*\(/gm,
    kind: "function",
    name: 1,
    exported: () => true,
  },
];

const RUBY_RULES: Rule[] = [
  {
    pattern: /^[\t ]*(?:class|module)[\t ]+([A-Z][\w:]*)/gm,
    kind: "class",
    name: 1,
  },
  {
    pattern: /^[\t ]*def[\t ]+(?:self\.)?([A-Za-z_]\w*[?!=]?)/gm,
    kind: "function",
    name: 1,
  },
];

const PHP_RULES: Rule[] = [
  {
    pattern:
      /^[\t ]*(?:(?:abstract|final|readonly)[\t ]+)*(?:class|interface|trait|enum)[\t ]+([A-Za-z_]\w*)/gm,
    kind: "class",
    name: 1,
  },
  {
    pattern:
      /^[\t ]*(?:(?:public|protected|static|final|abstract)[\t ]+)*function[\t ]+([A-Za-z_]\w*)/gm,
    kind: "function",
    name: 1,
  },
];

const RULES: Record<Ecosystem, Rule[]> = {
  js: JS_RULES,
  py: PY_RULES,
  go: GO_RULES,
  rust: RUST_RULES,
  jvm: JVM_RULES,
  ruby: RUBY_RULES,
  php: PHP_RULES,
};

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "new",
  "else",
  "do",
  "try",
  "when",
]);

function spanEnd(ecosystem: Ecosystem, lines: string[], line: number): number {
  if (ecosystem === "py") return indentEnd(lines, line, false);
  if (ecosystem === "ruby") return indentEnd(lines, line, true);
  return braceEnd(lines, line);
}

function routeSymbols(
  path: string,
  text: string,
  ecosystem: Ecosystem,
  starts: number[],
  lines: string[],
): ExtractedSymbol[] {
  const routes: ExtractedSymbol[] = [];
  const add = (
    method: string,
    route: string,
    offset: number,
    name?: string,
  ) => {
    const line = lineAt(starts, offset);
    const label = `${method.toUpperCase()} ${route || "/"}`;
    routes.push({
      name: name ?? label,
      kind: "route",
      line,
      endLine: spanEnd(ecosystem, lines, line),
      exported: true,
      route: label,
    });
  };

  if (ecosystem === "js") {
    const nextRoute = nextRouteOf(path);
    if (nextRoute) {
      const methods = new RegExp(
        `^export[\\t ]+(?:(?:async[\\t ]+)?function[\\t ]+|(?:const|let)[\\t ]+)(${HTTP_METHODS.join("|")})\\b`,
        "gm",
      );
      for (const match of text.matchAll(methods))
        add(match[1]!, nextRoute, match.index, match[1]!);
      if (/(?:^|\/)pages\/api\//.test(path)) {
        const handler = /^export[\t ]+default\b/m.exec(text);
        if (handler) add("ANY", nextRoute, handler.index, "handler");
      }
    }
    for (const match of text.matchAll(
      /\b(?:app|router|server|api|route|routes|fastify)\.(get|post|put|patch|delete|all|options)\(\s*["'`]([^"'`\n]{1,200})["'`]/gi,
    ))
      add(match[1]!, match[2]!, match.index);
  } else if (ecosystem === "py") {
    for (const match of text.matchAll(
      /^[\t ]*@[\w.]*?\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*(?:path\s*=\s*)?[rf]?["']([^"'\n]{0,200})["']([^\n]*)/gm,
    )) {
      const after = text.slice(match.index + match[0].length);
      const def =
        /^\s*(?:@[^\n]*\n\s*)*(?:async[\t ]+)?def[\t ]+([A-Za-z_]\w*)/.exec(
          after,
        );
      let method = match[1]!;
      if (method === "route" || method === "api_route") {
        const declared = /methods\s*=\s*\[\s*["'](\w+)["']/.exec(match[3]!);
        method = declared?.[1] ?? "GET";
      }
      add(method, match[2]!, match.index, def?.[1]);
    }
  } else if (ecosystem === "go") {
    for (const match of text.matchAll(
      /\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"([^"\n]{1,200})"/g,
    ))
      add(
        /^Handle/.test(match[1]!) ? "ANY" : match[1]!,
        match[2]!,
        match.index,
      );
  } else if (ecosystem === "jvm") {
    for (const match of text.matchAll(
      /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"\n]*)")?/g,
    ))
      add(
        match[1] === "Request" ? "ANY" : match[1]!,
        match[2] ?? "/",
        match.index,
      );
  } else if (ecosystem === "rust") {
    for (const match of text.matchAll(
      /#\[(get|post|put|patch|delete)\(\s*"([^"\n]{1,200})"/g,
    ))
      add(match[1]!, match[2]!, match.index);
    for (const match of text.matchAll(
      /\.route\(\s*"([^"\n]{1,200})"\s*,\s*(get|post|put|patch|delete)\(/g,
    ))
      add(match[2]!, match[1]!, match.index);
  } else if (ecosystem === "ruby" && /(?:^|\/)config\/routes\.rb$/.test(path)) {
    for (const match of text.matchAll(
      /^[\t ]*(get|post|put|patch|delete)[\t ]+["']([^"'\n]{1,200})["']/gm,
    ))
      add(match[1]!, match[2]!, match.index);
  } else if (ecosystem === "php") {
    for (const match of text.matchAll(
      /Route::(get|post|put|patch|delete|any)\(\s*["']([^"'\n]{1,200})["']/g,
    ))
      add(match[1]!, match[2]!, match.index);
  }
  return routes;
}

const NODE_BUILTINS = new Set([
  "fs",
  "path",
  "os",
  "url",
  "http",
  "https",
  "crypto",
  "stream",
  "util",
  "events",
  "child_process",
  "zlib",
  "buffer",
  "assert",
  "net",
  "tls",
  "readline",
  "worker_threads",
]);

function externalImports(
  text: string,
  ecosystem: Ecosystem,
  starts: number[],
): ExternalImport[] {
  const found: ExternalImport[] = [];
  const push = (specifier: string, offset: number) =>
    found.push({ specifier, line: lineAt(starts, offset) });
  if (ecosystem === "js") {
    for (const match of text.matchAll(
      /(?:\bfrom|^\s*import|\brequire\s*\(|\bimport\s*\()\s*["']([^"'\n]{1,200})["']/gm,
    )) {
      const specifier = match[1]!;
      if (/^[.~#/]|^@\//.test(specifier) || specifier.startsWith("node:"))
        continue;
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0]!;
      if (NODE_BUILTINS.has(name)) continue;
      push(specifier, match.index);
    }
  } else if (ecosystem === "py") {
    for (const match of text.matchAll(
      /^[\t ]*from[\t ]+([A-Za-z_][\w.]*)[\t ]+import\b/gm,
    ))
      push(match[1]!, match.index);
    for (const match of text.matchAll(/^[\t ]*import[\t ]+([A-Za-z_][\w.]*)/gm))
      push(match[1]!, match.index);
  } else if (ecosystem === "go") {
    for (const match of text.matchAll(
      /"([a-z0-9][\w.-]*\.[a-z]{2,}\/[^"\n]+)"/g,
    ))
      push(match[1]!, match.index);
    for (const match of text.matchAll(/"(database\/sql)"/g))
      push(match[1]!, match.index);
  } else if (ecosystem === "rust") {
    for (const match of text.matchAll(
      /^[\t ]*(?:pub[\t ]+)?use[\t ]+([A-Za-z_]\w*(?:::\w+)*)/gm,
    ))
      push(match[1]!, match.index);
  } else if (ecosystem === "jvm") {
    for (const match of text.matchAll(
      /^[\t ]*import[\t ]+(?:static[\t ]+)?([\w.]+)/gm,
    ))
      push(match[1]!, match.index);
  } else if (ecosystem === "ruby") {
    for (const match of text.matchAll(
      /^[\t ]*require[\t ]+["']([^"'\n]+)["']/gm,
    ))
      push(match[1]!, match.index);
  } else if (ecosystem === "php") {
    for (const match of text.matchAll(/^[\t ]*use[\t ]+([\w\\]+)/gm))
      push(match[1]!, match.index);
  }
  return found;
}

export function analyzeSource(path: string, text: string): FileAnalysis {
  const ecosystem = ecosystemOf(path);
  if (!ecosystem) return { ecosystem, symbols: [], imports: [] };
  const starts = lineStarts(text);
  const lines = text.split("\n");
  const symbols: ExtractedSymbol[] = [];
  const seen = new Set<string>();
  const routes = routeSymbols(path, text, ecosystem, starts, lines);
  const routeLines = new Set(routes.map((route) => route.line));
  for (const rule of RULES[ecosystem]) {
    for (const match of text.matchAll(rule.pattern)) {
      const name = match[rule.name];
      if (!name || KEYWORDS.has(name)) continue;
      const line = lineAt(
        starts,
        match.index + (match[0].length - match[0].trimStart().length),
      );
      const key = `${name}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A route handler is shown once, as its route.
      if (
        routes.some(
          (route) => route.name === name && Math.abs(route.line - line) <= 6,
        )
      )
        continue;
      if (routeLines.has(line)) continue;
      symbols.push({
        name,
        kind: rule.kind,
        line,
        endLine: spanEnd(ecosystem, lines, line),
        exported: rule.exported
          ? rule.exported(match as RegExpExecArray)
          : !name.startsWith("_"),
      });
    }
  }
  const all = [...routes, ...symbols].sort((a, b) => a.line - b.line);
  return {
    ecosystem,
    symbols: all.slice(0, MAX_SYMBOLS_PER_FILE),
    imports: externalImports(text, ecosystem, starts),
  };
}
