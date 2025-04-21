# Crash Report

Crash Reporter Module for Deno Applications.

This module automatically captures uncaught exceptions (`error` event) and
unhandled promise rejections (`unhandledrejection` event) in your Deno
application.

When an error is detected, it:
1.  Prevents Deno's default error logging.
2.  Prints detailed error information to the console.
3.  Attempts to display a native GUI confirmation dialog (platform-specific:
    Windows/PowerShell, macOS/osascript, Linux/zenity) asking the user if they
    want to send a report. Falls back to a console prompt if GUI fails or
    permissions are missing.
4.  If confirmed by the user, sends a structured JSON crash report (including
    error details, timestamp, and basic environment info) via a POST request
    to a configured backend server endpoint.
5.  Exits the Deno application with a non-zero status code (`Deno.exit(1)`).

An optional, basic collector server using Deno KV is also included.

## Quick Start: Automatic Error Hooking

This is the recommended way to use the module for automatic reporting of
uncaught errors and rejections.

**1. Import the Hook:**

Add this import as the **very first line** in your application's main entry
point script:

```typescript
// main.ts (or your entry point file)

// Import the hook FIRST!
import "jsr:@sigmasd/crash-report/hook";

// --- Your application code starts below ---
console.log("App starting...");

// Example: This error will be caught and reported (after confirmation)
// throw new Error("Something went critically wrong!");

// Example: This unhandled rejection will also be caught
// Promise.reject(new Error("Async operation failed unexpectedly!"));

// ... rest of your application logic
```

**2. Configure the Server URL:**

Set the `CRASH_REPORT_BASE_URL` environment variable *before* running your
application. This tells the reporter where to send the crash data.

```bash
# Example on Linux/macOS
export CRASH_REPORT_BASE_URL="https://your-crash-report-server.com"
deno run --allow-env=CRASH_REPORT_BASE_URL --allow-net=your-crash-report-server.com --allow-run=zenity main.ts

# Example on Windows (PowerShell)
$env:CRASH_REPORT_BASE_URL="https://your-crash-report-server.com"
deno run --allow-env=CRASH_REPORT_BASE_URL --allow-net=your-crash-report-server.com --allow-run=powershell main.ts
```

## Optional Collector Server

This repository includes a basic server (`src/collector.ts`) that can receive
and store crash reports using Deno KV.

**Running the Collector Server:**

```bash
# Clone the repository if you haven't already
# git clone https://github.com/your-repo/crash-report.git
# cd crash-report

# Run the collector server
# This example uses an ephemeral in-memory KV store.
deno run --allow-net --allow-read --allow-write src/collector.ts

# For persistent storage across restarts, specify a KV path:
export DENO_KV_PATH="./my_crash_reports.kv"
deno run --allow-net --allow-read=. --allow-write=. --allow-env=DENO_KV_PATH src/collector.ts

# The server listens on port 8080 by default. Reports are sent to /api/report.
# Your CRASH_REPORT_BASE_URL for the client would be http://<server_ip>:8080
```

## Report Payload Structure

When a report is sent, the final JSON payload POSTed to the server looks like this:

```json
{
  "timestamp": "2023-10-27T10:30:00.123Z", // ISO 8601 timestamp when report was sent
  "report": {
    // Content depends on the error type ('error' or 'unhandledrejection')
    // Example for 'error':
    "type": "error",
    "message": "Something went critically wrong!",
    "filename": "file:///path/to/your/main.ts",
    "lineno": 10,
    "colno": 5,
    "error": { // Serialized error object
      "name": "Error",
      "message": "Something went critically wrong!",
      "stack": "Error: Something went critically wrong!\n    at file:///path/to/your/main.ts:10:5"
      // ... other custom error properties might appear here
    }
    // Example for 'unhandledrejection':
    // "type": "unhandledrejection",
    // "reason": { ... serialized rejection reason ... }
  },
  "reporterInfo": {
    "os": "linux", // e.g., "windows", "darwin", "linux"
    "arch": "x86_64",
    "denoVersion": "1.38.0",
    // Consider adding appName/appVersion via env vars if needed
  }
}
```

## Manual Reporting (Advanced)

While the automatic hook (`import "jsr:@sigmasd/crash-report/hook"`) is recommended
for general use, you might want to manually trigger a crash report from within
a specific `try...catch` block, perhaps for errors that you handle but still want
to report.

**1. Import Necessary Functions:**

```typescript
import { crashReport, CRASH_REPORT_ENDPOINT } from "jsr:@sigmasd/crash-report/reporter";
```

**2. Implement the Reporting Logic:**

```typescript
async function performCriticalTask() {
  // Ensure CRASH_REPORT_BASE_URL is set in the environment and necessary permissions are granted!
  if (!CRASH_REPORT_ENDPOINT) {
    console.warn("Manual crash report skipped: CRASH_REPORT_BASE_URL not set.");
    // Handle the error locally without reporting
    return;
  }

  try {
    // ... code that might throw a specific, handled error ...
    const result = await someRiskyOperation();
    if (!result.success) {
        throw new Error(`Risky operation failed with code: ${result.errorCode}`);
    }
    console.log("Critical task completed successfully.");

  } catch (error) {
    console.error("Caught an error during critical task:", error);

    // Decide to manually report this specific error
    console.log("Attempting to manually send a crash report...");

    // 1. Prepare the report data object
    const reportData = {
      type: "manual_report", // Use a custom type
      error: error,
      context: "Error occurred during performCriticalTask()", // Add custom context
      // Add any other relevant data
    };

    // 2. Stringify the report data
    const reportJsonString = JSON.stringify(reportData, null, 2); // Pretty print for console

    // 3. Call crashReport (this shows the confirmation dialog)
    await crashReport(reportJsonString);

    // 4. Decide what to do next - crashReport does NOT exit automatically
    console.error("Manual report process finished. Exiting application.");
    Deno.exit(1); // Or handle the error differently, e.g., retry, fallback
  }
}

// Example usage:
performCriticalTask();
```

**Important Considerations for Manual Reporting:**

*   **Configuration/Permissions:** You *still* need the
    `CRASH_REPORT_BASE_URL` environment variable set and the relevant
    `--allow-env`, `--allow-net`, and `--allow-run` permissions granted.
*   **Serialization:** Always use `serializeValueForReport(error)` when including
    an `Error` object in your `reportData` before stringifying.
*   **Process Exit:** Calling `crashReport` manually does **not** automatically
    exit your application. You must explicitly call `Deno.exit(1)` or implement
    other error handling logic within your `catch` block after the
    `await crashReport(...)` call completes.
*   **Use Case:** Manual reporting is best suited for non-fatal errors that you
    catch and handle but still want visibility into via your reporting backend.
    For truly *uncaught* errors, the automatic hook is preferred.

## Notes & Considerations

*   **Import Order:** Always import `jsr:@sigmasd/crash-report/hook` as the
    **very first** line of your application to ensure it catches errors from
    the start.
*   **Configuration:** The reporter is **inactive** if the
    `CRASH_REPORT_BASE_URL` environment variable is not set. A warning will be
    logged in this case.
*   **GUI Dependencies:** On Linux, `zenity` must be installed for the graphical
    dialog. Windows PowerShell and macOS `osascript` are typically built-in.
*   **Exiting:** The hook ensures the application exits (`Deno.exit(1)`) after an
    uncaught error is processed, regardless of whether the report was sent (due
    to user declining or network errors).
*   **Manual Reporting:** While the hook provides automatic handling, you can
    trigger the reporting process manually by importing `crashReport` from
    `jsr:@sigmasd/crash-report/reporter` (the main export). See the JSDoc in
    `src/reporter.ts` for details, but this is less common.
