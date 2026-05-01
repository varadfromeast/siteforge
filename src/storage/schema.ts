import { CURRENT_SCHEMA_VERSION } from '../core/index.js';
import { SchemaVersionError } from './errors.js';

export function assertCurrentSchema(filePath: string, found: unknown): void {
  if (found !== CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(filePath, CURRENT_SCHEMA_VERSION, found);
  }
}
