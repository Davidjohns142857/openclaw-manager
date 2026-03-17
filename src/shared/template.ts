export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{\s*([^}\s]+)\s*}}/g, (_, key: string) => values[key] ?? "");
}

