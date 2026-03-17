import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ??
  Ajv2020Module) as new (options: Record<string, unknown>) => {
  compile(schema: object): ValidateFunction;
};

export type SchemaKind =
  | "session"
  | "run"
  | "event"
  | "skill-trace"
  | "attention-unit"
  | "capability-fact"
  | "inbound-message"
  | "connector-binding"
  | "checkpoint";

const schemaFileByKind: Record<SchemaKind, string> = {
  session: "session.schema.json",
  run: "run.schema.json",
  event: "event.schema.json",
  "skill-trace": "skill-trace.schema.json",
  "attention-unit": "attention-unit.schema.json",
  "capability-fact": "capability-fact.schema.json",
  "inbound-message": "inbound-message.schema.json",
  "connector-binding": "connector-binding.schema.json",
  checkpoint: "checkpoint.schema.json"
};

export class SchemaRegistry {
  schemasDir: string;
  ajv: {
    compile(schema: object): ValidateFunction;
  };
  validators: Map<SchemaKind, Promise<ValidateFunction>>;

  constructor(schemasDir: string) {
    this.schemasDir = schemasDir;
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false
    });
    this.validators = new Map();
  }

  async validateOrThrow(kind: SchemaKind, value: unknown): Promise<void> {
    const validator = await this.getValidator(kind);

    if (validator(value)) {
      return;
    }

    const errors = (validator.errors ?? [])
      .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");

    throw new Error(`Schema validation failed for ${kind}: ${errors}`);
  }

  getValidator(kind: SchemaKind): Promise<ValidateFunction> {
    const existing = this.validators.get(kind);

    if (existing) {
      return existing;
    }

    const pending = this.loadValidator(kind);
    this.validators.set(kind, pending);
    return pending;
  }

  async loadValidator(kind: SchemaKind): Promise<ValidateFunction> {
    const schemaPath = path.join(this.schemasDir, schemaFileByKind[kind]);
    const raw = await readFile(schemaPath, "utf8");
    const schema = JSON.parse(raw) as object;
    return this.ajv.compile(schema);
  }
}
