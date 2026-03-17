import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ??
  Ajv2020Module) as new (options: Record<string, unknown>) => {
  addSchema(schema: object): void;
  compile(schema: object): ValidateFunction;
  getSchema(key: string): ValidateFunction | undefined;
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
  | "checkpoint"
  | "local-distillation"
  | "fact-outbox-batch"
  | "fact-outbox-receipt";

const schemaFileByKind: Record<SchemaKind, string> = {
  session: "session.schema.json",
  run: "run.schema.json",
  event: "event.schema.json",
  "skill-trace": "skill-trace.schema.json",
  "attention-unit": "attention-unit.schema.json",
  "capability-fact": "capability-fact.schema.json",
  "inbound-message": "inbound-message.schema.json",
  "connector-binding": "connector-binding.schema.json",
  checkpoint: "checkpoint.schema.json",
  "local-distillation": "local-distillation.schema.json",
  "fact-outbox-batch": "fact-outbox-batch.schema.json",
  "fact-outbox-receipt": "fact-outbox-receipt.schema.json"
};

export class SchemaRegistry {
  schemasDir: string;
  ajv: {
    addSchema(schema: object): void;
    compile(schema: object): ValidateFunction;
    getSchema(key: string): ValidateFunction | undefined;
  };
  validators: Map<SchemaKind, Promise<ValidateFunction>>;
  allSchemasLoaded: Promise<void> | null;

  constructor(schemasDir: string) {
    this.schemasDir = schemasDir;
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false
    });
    this.validators = new Map();
    this.allSchemasLoaded = null;
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
    await this.ensureAllSchemasLoaded();
    const schemaPath = path.join(this.schemasDir, schemaFileByKind[kind]);
    const raw = await readFile(schemaPath, "utf8");
    const schema = JSON.parse(raw) as { $id?: string };

    if (typeof schema.$id === "string") {
      const existing = this.ajv.getSchema(schema.$id);

      if (existing) {
        return existing;
      }
    }

    return this.ajv.compile(schema);
  }

  private ensureAllSchemasLoaded(): Promise<void> {
    if (this.allSchemasLoaded) {
      return this.allSchemasLoaded;
    }

    this.allSchemasLoaded = this.loadAllSchemas();
    return this.allSchemasLoaded;
  }

  private async loadAllSchemas(): Promise<void> {
    for (const schemaFile of Object.values(schemaFileByKind)) {
      const schemaPath = path.join(this.schemasDir, schemaFile);
      const raw = await readFile(schemaPath, "utf8");
      const schema = JSON.parse(raw) as { $id?: string };

      if (typeof schema.$id === "string" && this.ajv.getSchema(schema.$id)) {
        continue;
      }

      this.ajv.addSchema(schema);
    }
  }
}
