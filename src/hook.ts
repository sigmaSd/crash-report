/**
 * @module crash-report/hook
 *
 * Crash Report Hook Module for Deno Applications.
 *
 * This module should be imported **once** at the very beginning of your
 * application's entry point. It automatically attaches global event listeners
 * for `error` (uncaught exceptions) and `unhandledrejection` (unhandled promise
 * rejections).
 *
 * When an error is caught, it prevents Deno's default error logging, collects
 * error details, uses the `crashReport` function from `./reporter.ts` to potentially
 * display a GUI confirmation dialog and send the report to the configured server,
 * and finally exits the application with a non-zero status code (`Deno.exit(1)`).
 *
 * **IMPORTANT:** This module requires the `CRASH_REPORT_BASE_URL` environment
 * variable to be set for reporting to be active.
 *
 * @example
 * ```typescript
 * // main.ts (Your application entry point)
 *
 * // Import this module FIRST!
 * import "jsr:@sigmasd/crash-report/hook";
 *
 * // Set the environment variable before running:
 * // export CRASH_REPORT_BASE_URL="https://your-report-server.com"
 *
 * // Your application code starts here...
 * console.log("App starting");
 *
 * // This error will be caught by the hook
 * // throw new Error("Something went wrong!");
 *
 * // This unhandled rejection will also be caught
 * // Promise.reject("Something async went wrong!");
 * ```
 */
import {
  CRASH_REPORT_BASE_URL,
  CRASH_REPORT_ENDPOINT,
  crashReport,
} from "./reporter.ts";
import { serializeValueForReport } from "./utils.ts";

// -------- Hook error events -----------
// If the crash reporting endpoint is configured, hook error events.
if (CRASH_REPORT_ENDPOINT) {
  console.log(
    `Crash reporter activated. Reports will be sent to: ${CRASH_REPORT_BASE_URL}`,
  );

  self.addEventListener("error", async (event: ErrorEvent) => {
    console.error("\n--- Uncaught Error Captured ---");
    event.preventDefault(); // Prevent Deno's default logging

    // Construct the report data object first
    const reportData = {
      type: "error", // Add type for context
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: serializeValueForReport(event.error), // Use the helper
    };

    // Stringify the structured data
    const reportJson = JSON.stringify(reportData, null, 2); // Pretty print for console log

    try {
      await crashReport(reportJson);
    } finally {
      // Ensure exit happens even if crashReport itself throws an error
      console.error("Exiting due to uncaught error.");
      Deno.exit(1);
    }
  });

  self.addEventListener(
    "unhandledrejection",
    async (event: PromiseRejectionEvent) => {
      console.error("\n--- Unhandled Promise Rejection Captured ---");
      event.preventDefault(); // Prevent Deno's default logging

      // Construct the report data object first
      const reportData = {
        type: "unhandledrejection", // Add type for context
        reason: serializeValueForReport(event.reason), // Use the helper
      };

      // Stringify the structured data
      const reportJson = JSON.stringify(reportData, null, 2);

      try {
        await crashReport(reportJson);
      } finally {
        // Ensure exit happens even if crashReport itself throws an error
        console.error("Exiting due to unhandled promise rejection.");
        Deno.exit(1);
      }
    },
  );
} else {
  console.warn(
    "Crash reporter inactive: CRASH_REPORT_BASE_URL environment variable not set.",
  );
}
