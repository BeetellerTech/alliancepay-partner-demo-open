import { AppError } from "./errors";
import type { Json } from "./types";

// required_fields describes the shape of an optional section when it is supplied.
// An explicit required:false takes precedence over the presence of that list.
export function requiresSection(rule: Json | undefined): boolean {
  return rule?.required ?? Boolean(rule?.required_fields?.length);
}

export function enforceRequirements(requirements: Json | undefined, payload: Json) {
  for (const section of ["payer", "phone", "billing_address"]) {
    const rule = requirements?.[section];
    if (!requiresSection(rule) && payload[section] === undefined) continue;
    if (requiresSection(rule) && !payload[section]) throw new AppError(400, `Preencha os dados obrigatórios de ${section}.`);
    for (const field of rule?.required_fields || []) {
      if (!payload[section]?.[field]) throw new AppError(400, `Campo obrigatório: ${section}.${field}.`);
    }
  }
}
