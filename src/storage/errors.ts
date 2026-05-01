export class SchemaVersionError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly expected: number,
    public readonly found: unknown,
  ) {
    super(
      `Unsupported schema_version in ${filePath}: expected ${expected}, found ${String(found)}`,
    );
    this.name = 'SchemaVersionError';
  }
}
