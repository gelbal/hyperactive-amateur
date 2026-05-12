// ABOUTME: Inline string constants matching the Gemini REST schema enums.
// ABOUTME: Lets us build request bodies without importing @google/genai into the client bundle.

// The Gemini REST API accepts these uppercase strings directly for the
// `type` field of a response schema (object, array, primitives). Mirrors
// the @google/genai `Type` enum, which is itself just an `as const` map
// over the same strings.
export const SchemaType = {
  OBJECT: "OBJECT",
  ARRAY: "ARRAY",
  STRING: "STRING",
  NUMBER: "NUMBER",
  INTEGER: "INTEGER",
  BOOLEAN: "BOOLEAN",
} as const;

// Thinking levels in the Gemini REST schema are lowercase strings on the
// generationConfig.thinkingConfig field. Only HIGH is used today; add
// LOW/MEDIUM here when a call site needs them.
export const ThinkingLevel = {
  HIGH: "high",
} as const;
