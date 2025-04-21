/**
 * Serializes a value for inclusion in the crash report, paying special
 * attention to Error objects to capture stack traces and messages.
 * @param value The value to serialize (e.g., event.error, event.reason)
 * @returns A representation suitable for JSON stringification.
 */
// deno-lint-ignore no-explicit-any
export function serializeValueForReport(value: unknown): any {
  if (value instanceof Error) {
    // Capture standard error properties
    // deno-lint-ignore no-explicit-any
    const errorObj: Record<string, any> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    // Capture any additional own properties (enumerable or not), like 'code'
    Object.getOwnPropertyNames(value).forEach((key) => {
      if (key !== "name" && key !== "message" && key !== "stack") {
        // deno-lint-ignore no-explicit-any
        errorObj[key] = (value as any)[key];
      }
    });
    return errorObj;
  }

  // Handle AggregateError specifically if available (Deno supports it)
  if (
    typeof AggregateError !== "undefined" && value instanceof AggregateError
  ) {
    // deno-lint-ignore no-explicit-any
    const errorObj: Record<string, any> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
      // Recursively serialize the aggregated errors
      errors: value.errors.map(serializeValueForReport),
    };
    Object.getOwnPropertyNames(value).forEach((key) => {
      if (
        key !== "name" && key !== "message" && key !== "stack" &&
        key !== "errors"
      ) {
        // deno-lint-ignore no-explicit-any
        errorObj[key] = (value as any)[key];
      }
    });
    return errorObj;
  }

  // For non-Error values, return them as is. JSON.stringify will handle
  // primitives, plain objects, and arrays. It might produce less useful
  // output for other complex objects (like Promises, Maps, Sets), but
  // this is generally acceptable for a crash report's context details.
  return value;
}
