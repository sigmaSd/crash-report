/**
 * @module crash-report/reporter
 *
 * Core Crash Reporter Logic for Deno Applications.
 *
 * This module provides the central `crashReport` function responsible for
 * handling the report submission process. It includes:
 * - Displaying a native GUI dialog (platform-specific) to ask the user for
 *   confirmation before sending a report.
 * - Formatting the final payload including timestamp and environment details.
 * - Sending the report payload as JSON to the configured backend endpoint via `fetch`.
 * - Handling internal errors within the reporter itself.
 *
 * **Key Exports:**
 * - `CRASH_REPORT_BASE_URL`: The base URL read from the environment variable.
 * - `CRASH_REPORT_ENDPOINT`: The full URL endpoint (`/api/report` appended) where reports are sent.
 * - `crashReport(reportContent)`: Function to initiate the reporting process.
 *
 * @example
 * ```typescript
 * // This example shows *manual* triggering, usually you'd import the hook instead.
 * import { crashReport, CRASH_REPORT_ENDPOINT } from "jsr:@sigmasd/crash-report/reporter";
 *
 * // Ensure CRASH_REPORT_BASE_URL is set in the environment
 * // export CRASH_REPORT_BASE_URL="https://your-report-server.com"
 *
 * async function myCriticalFunction() {
 *   try {
 *     // ... some code that might throw ...
 *     throw new Error("A critical failure occurred!");
 *   } catch (error) {
 *     console.error("Caught critical error:", error);
 *     if (CRASH_REPORT_ENDPOINT) { // Check if reporting is configured
 *       // You can now pass an object directly:
 *       await crashReport({
 *         type: "manual_report",
 *         error: error,
 *         context: "From myCriticalFunction"
 *       });
 *
 *       // Or a simple message:
 *       // await crashReport("Application crashed during initialization");
 *     }
 *     // Decide whether to exit or continue after manual report attempt
 *     Deno.exit(1);
 *   }
 * }
 *
 * myCriticalFunction();
 *
 * // NOTE: For automatic reporting of *uncaught* errors/rejections,
 * // simply import the hook at the start of your app:
 * // import "jsr:@sigmasd/crash-report/hook";
 */

import { serializeValueForReport } from "./utils.ts";

/**
 * The base URL for the crash report server, read from the
 * `CRASH_REPORT_BASE_URL` environment variable. Trailing slashes are removed.
 * Will be `undefined` if the environment variable is not set.
 */
export const CRASH_REPORT_BASE_URL: string | undefined = Deno.env.get(
  "CRASH_REPORT_BASE_URL",
)
  ?.replace(/\/$/, "");
/**
 * The full endpoint URL where crash reports will be POSTed.
 * Constructed by appending `/api/report` to `CRASH_REPORT_BASE_URL`.
 * Will be `null` if `CRASH_REPORT_BASE_URL` is not set, effectively disabling reporting.
 */
export const CRASH_REPORT_ENDPOINT: string | null = CRASH_REPORT_BASE_URL
  ? `${CRASH_REPORT_BASE_URL}/api/report`
  : null; // Make it nullable if base url isn't set

const textDecoder = new TextDecoder(); // Reuse decoder

/**
 * Submits a crash report after showing a confirmation dialog to the user.
 *
 * @param reportContent The report data to send - can be:
 *   - An object: Will be sent as structured data
 *   - A string: Will be sent as a message
 *   - Other types will be converted appropriately
 * @returns A Promise that resolves when the reporting process is complete
 */
export async function crashReport(
  reportContent: unknown,
): Promise<void> {
  console.error("--- Crash Reporter Initializing ---");

  try {
    // Convert to string for logging purposes
    let reportContentString: string;

    if (typeof reportContent === "string") {
      reportContentString = reportContent;
    } else if (reportContent === undefined || reportContent === null) {
      reportContentString = "Empty report (undefined or null)";
    } else if (typeof reportContent === "object") {
      try {
        // Format JSON with indentation for better readability in logs
        reportContentString = JSON.stringify(reportContent, null, 2);
      } catch (err) {
        // Handle circular references or other serialization issues
        reportContentString = `Error serializing report object: ${
          err instanceof Error ? err.message : String(err)
        }
Original object type: ${typeof reportContent}`;
      }
    } else {
      // Handle primitive values
      reportContentString = String(reportContent);
    }

    if (
      !reportContentString || reportContentString.trim() === "" ||
      reportContentString.trim() === "{}"
    ) {
      console.error("--- Received empty or minimal report data. Exiting. ---");
      // Still exit with error code, as an error occurred to trigger this.
      Deno.exit(1);
      return;
    }

    // Log the report content
    console.error("\n--- Crash Report Details ---");
    console.error(reportContentString);
    console.error("---------------------------\n");

    // Show GUI confirmation dialog
    const confirmed = await showConfirmationDialog();

    // Handle the response
    if (confirmed) {
      console.log("User accepted via GUI. Attempting to send report...");
      await sendReport(reportContent); // Pass the original content
    } else {
      console.log("User declined via GUI or dialog failed. Report not sent.");
    }
  } catch (err) {
    console.error(
      "\nError in crash reporter:",
      err instanceof Error ? err.stack : err,
    );
    // Optionally try to send the reporter's own error (without GUI confirmation)
    if (CRASH_REPORT_ENDPOINT) { // Check if sending is possible
      try {
        const internalErrorReport = {
          type: "reporter_internal_error",
          error: serializeValueForReport(err),
          original_report: reportContent,
        };
        console.error("Attempting to send internal error report...");
        // Send directly without confirmation
        await sendReportInternal(internalErrorReport);
        console.error("Attempted to send internal error report.");
      } catch (sendErr) {
        console.error(
          "Failed to send internal error report:",
          sendErr instanceof Error ? sendErr.stack : sendErr,
        );
      }
    }
    // Deno.exit(1) is called in the event handlers after crashReport finishes or fails
  }
  // Note: Deno.exit(1) should be called in the event handlers *after* this function returns or throws.
}

/**
 * Shows a platform-specific GUI dialog asking for confirmation.
 * @returns Promise<boolean> True if the user confirmed, false otherwise.
 */
async function showConfirmationDialog(): Promise<boolean> {
  const title = "Crash Report";
  // Keep the message generic, as showing raw details isn't very user-friendly in a dialog.
  const message =
    `An application error occurred.\n\nDetails have been printed to the console/terminal.\n\nDo you want to send an anonymous crash report to help improve the application?`;
  const sendButton = "Send Report";
  const cancelButton = "Don't Send";

  try {
    let command: Deno.Command;
    let successCondition: (output: Deno.CommandOutput) => boolean;

    switch (Deno.build.os) {
      case "windows": {
        console.log("Using PowerShell for dialog...");
        const psCommand = `
                    Add-Type -AssemblyName System.Windows.Forms;
                    $result = [System.Windows.Forms.MessageBox]::Show('${
          message.replace(/'/g, "''") // Basic escaping for PowerShell string
        }', '${
          title.replace(/'/g, "''")
        }', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning, [System.Windows.Forms.MessageBoxDefaultButton]::Button1);
                    if ($result -eq 'Yes') { exit 0 } else { exit 1 }
                `;
        command = new Deno.Command("powershell", {
          args: ["-NoProfile", "-Command", psCommand],
          stdin: "null",
          stdout: "piped", // Capture stdout to check if needed
          stderr: "piped",
        });
        // Success is exit code 0
        successCondition = (output) => output.success;
        break;
      }

      case "darwin": // macOS
      {
        console.log("Using osascript for dialog...");
        const appleScript = `display dialog "${message.replace(/"/g, '\\"') // Basic escaping for AppleScript string
        }" with title "${
          title.replace(/"/g, '\\"')
        }" buttons {"${cancelButton}", "${sendButton}"} default button "${sendButton}" with icon caution
                    set the button_pressed to button returned of the result
                    if button_pressed is "${sendButton}" then
                        return 0 -- Convention for success
                    else
                        error number -128 -- Standard cancel code
                    end if`;
        command = new Deno.Command("osascript", {
          args: ["-e", appleScript],
          stdin: "null",
          stdout: "piped", // Capture stdout just in case
          stderr: "piped",
        });
        // Success is exit code 0 (osascript error -128 means user cancelled)
        successCondition = (output) => output.success;
        break;
      }

      case "linux": {
        console.log(
          "Using zenity for dialog (requires zenity to be installed)...",
        );
        command = new Deno.Command("zenity", {
          args: [
            "--question",
            "--title",
            title,
            "--text",
            message,
            "--ok-label",
            sendButton,
            "--cancel-label",
            cancelButton,
            "--icon=dialog-warning",
            "--width=400", // Optional: set a width
          ],
          stdin: "null",
          stdout: "null", // Zenity uses exit code for result
          stderr: "piped",
        });
        // Success is exit code 0
        successCondition = (output) => output.success;
        break;
      }
      default: {
        console.warn(
          `Unsupported OS (${Deno.build.os}) for GUI dialog. Falling back to console prompt.`,
        );
        return confirm(`${message}\nSend report?`);
      }
    }

    // Execute the command
    console.log("Waiting for user response in dialog...");
    const output = await command.output(); // Use output() to wait and get result

    if (successCondition(output)) {
      console.log("Dialog confirmed by user.");
      return true; // User confirmed
    } else {
      const stderr = textDecoder.decode(output.stderr).trim();
      // Check for specific cancel codes or messages if needed (e.g., osascript error -128)
      if (!output.success || stderr) { // If failed or has stderr
        if (stderr) {
          console.error(
            `Dialog command failed or was cancelled. Code: ${output.code}, Stderr: ${stderr}`,
          );
        } else {
          console.log(
            `Dialog command exited with code ${output.code} (likely cancelled by user).`,
          );
        }
      } else {
        console.log("Dialog cancelled by user.");
      }
      return false; // User cancelled or command failed
    }
  } catch (err) {
    console.error("--------------------------------------------------");
    console.error("FATAL: Failed to display or execute GUI dialog command.");
    if (err instanceof Deno.errors.NotFound) {
      console.error(
        "=> The required dialog command (e.g., zenity, powershell, osascript) might not be installed or found in the system's PATH.",
      );
    } else {
      console.error(
        "=> Error details:",
        err instanceof Error ? err.stack : err,
      );
    }
    console.error("--------------------------------------------------");
    console.error("Report will not be sent automatically.");
    return false; // Don't send if dialog failed
  }
}

/**
 * Sends the report to the configured endpoint.
 * @param reportContent The report content (object or string).
 */
async function sendReport(reportContent: unknown) {
  if (!CRASH_REPORT_ENDPOINT) {
    console.error("CRASH_REPORT_BASE_URL not set, cannot send report.");
    return;
  }
  await sendReportInternal(reportContent);
}

/**
 * Internal function to actually send the report via fetch.
 * Used by both normal reporting and internal error reporting.
 * @param reportContent The report content (object or string).
 */
async function sendReportInternal(reportContent: unknown) {
  if (!CRASH_REPORT_ENDPOINT) return; // Should not happen if called correctly, but safeguard

  console.log(`Sending report to: ${CRASH_REPORT_ENDPOINT}`);

  // Prepare the report payload based on the type of input
  let reportPayload: unknown;

  if (typeof reportContent === "string") {
    // Simple approach: wrap strings as messages
    reportPayload = { message: reportContent };
  } else {
    // Already an object or other value, use directly
    reportPayload = reportContent;
  }

  try {
    // Requires --allow-net=<hostname> or --allow-net
    const response = await fetch(CRASH_REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `DenoCrashReporter/${Deno.version.deno}`,
      },
      body: JSON.stringify({ // Structure the final payload for the server
        timestamp: new Date().toISOString(),
        // Embed the processed report
        report: reportPayload,
        reporterInfo: {
          os: Deno.build.os,
          arch: Deno.build.arch,
          denoVersion: Deno.version.deno,
          // Consider adding app name/version if available via env vars
          // appName: Deno.env.get("APP_NAME"),
          // appVersion: Deno.env.get("APP_VERSION"),
        },
      }),
    });

    if (response.ok) {
      console.log("Report sent successfully!");
    } else {
      console.error(
        `Failed to send report: ${response.status} ${response.statusText}`,
      );
      try {
        const errorBody = await response.text();
        if (errorBody) console.error("Server response body:", errorBody);
      } catch (_) { /* Ignore error reading body */ }
    }
  } catch (error) {
    console.error(
      "Network or fetch error:",
      error instanceof Error ? error.stack : error,
    );
  }
}
