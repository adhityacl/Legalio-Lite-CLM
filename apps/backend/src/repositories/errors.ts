/**
 * Errors raised by repositories. They carry an HTTP `status`, a stable `apiCode` and a message written for end users
 * (`expose`), so the shared error responder answers them with the unified error body and no route needs its own try/catch.
 */
export class RepositoryError extends Error {
  readonly expose = true;
  constructor(readonly status: number, readonly apiCode: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/** The row changed since the version the caller read (lost update prevented). */
export class VersionConflictError extends RepositoryError {
  constructor(entity: string, id: string, expected: number) {
    super(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Reload it and apply your change again.', { entity, id, expectedVersion: expected });
  }
}

/** Another row already uses a value that must be unique inside the organization. */
export class DuplicateValueError extends RepositoryError {
  constructor(readonly field: string, message: string) {
    super(409, 'DUPLICATE_VALUE', message, { field });
  }
}

export class RecordNotFoundError extends RepositoryError {
  constructor(entity: string, id: string) {
    super(404, 'RESOURCE_NOT_FOUND', 'Resource not found.', { entity, id });
  }
}
