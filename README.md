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

// Set the environment variable before running
// export CRASH_REPORT_BASE_URL="https://your-report-server.com"

// Your application code starts here...
console.log("App starting");

// Example of an error that would be caught:
// throw new Error("Something went wrong!");

// Example of an unhandled rejection:
// Promise.reject("Something async went wrong!");
```

Notes:

- **IMPORT ORDER:** For maximum effectiveness, this module should be imported as
  the **very first line** of your application's entry point script. This ensures
  the error handlers are attached before any of your code runs or other modules
  are imported.
- **ENVIRONMENT VARIABLE:** Requires the `CRASH_REPORT_BASE_URL` environment
  variable to be set to the base URL of your crash report receiving server
  (e.g., `https://my-crash-server.com`). The reporter will send reports to
  `{CRASH_REPORT_BASE_URL}/api/report`. If this variable is not set, the crash
  reporter will not activate.
- **PERMISSIONS:** This module requires the following Deno permissions:
  - `--allow-env=CRASH_REPORT_BASE_URL`: To read the server URL.
  - `--allow-net={hostname}`: To send the report via `fetch` to the specified
    host. Replace `{hostname}` with the actual hostname from
    `CRASH_REPORT_BASE_URL`. Alternatively, `--allow-net` can be used, but is
    less secure.
  - `--allow-run=powershell,osascript,zenity`: To display native GUI
    confirmation dialogs on Windows, macOS, and Linux respectively. Grant
    permissions only for the commands relevant to the target platforms.
- **DEPENDENCIES:** On Linux, the `zenity` command-line tool must be installed
  for the GUI dialog to work. On Windows, PowerShell is expected. On macOS,
  `osascript` is used.
- **EXITING:** Upon capturing an error and completing (or attempting) the report
  process, the reporter will explicitly exit the Deno process using
  `Deno.exit(1)`. The `event.preventDefault()` calls attempt to stop Deno's
  default error logging.
