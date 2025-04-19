# Crash Report

Crash Reporter Module for Deno Applications.

This module hooks into global error handlers (`error` and `unhandledrejection`)
to capture uncaught exceptions and unhandled promise rejections. When an error
occurs, it attempts to display a native GUI dialog (platform-specific) asking
the user for confirmation before sending a crash report to a configured backend
endpoint.

## Examples

**Example 1**

```typescript
// Import this as the very first line in your main application script
import "jsr:@sigmasd/crash-report";

// Your application code starts here...
console.log("App starting");

// Example of an error that would be caught:
// throw new Error("Something went wrong!");

// Example of an unhandled rejection:
// Promise.reject("Something async went wrong!");
```
