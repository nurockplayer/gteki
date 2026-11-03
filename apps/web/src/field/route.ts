export interface Stop { id: string; title: string; items: string[]; ids: string[]; instructions: string }

export function parseRoute(markdown: string): Stop[] {
  const walk = markdown.split(/^## Ordered walk\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...walk.matchAll(/^### (\S+) · (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)].map((match) => {
    const body = match[3]!;
    return {
      id: match[1]!, title: match[2]!,
      items: (body.match(/^- \*\*Items:\*\* (.+)$/m)?.[1] ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      ids: [...new Set([...body.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1]!.split(/[^\w:.-]+/).filter(Boolean)))],
      instructions: body.trim(),
    };
  });
}
