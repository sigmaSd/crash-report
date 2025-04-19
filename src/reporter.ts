/**
 * # Crash Report
 * Crash Reporter Module for Deno Applications.
 *
 * This module hooks into global error handlers (`error` and `unhandledrejection`)
 * to capture uncaught exceptions and unhandled promise rejections. When an error
 * occurs, it attempts to display a native GUI dialog (platform-specific)
 * asking the user for confirmation before sending a crash report to a
 * configured backend endpoint.
 *
 * @module
 *
 * @example
 * ```typescript
 * // Import this as the very first line in your main application script
 * import "jsr:@sigmasd/crash-report";
 *
 * // Set the environment variable before running
 * // export CRASH_REPORT_BASE_URL="https://your-report-server.com"
 *
 * // Your application code starts here...
 * console.log("App starting");
 *
 * // Example of an error that would be caught:
 * // throw new Error("Something went wrong!");
 *
 * // Example of an unhandled rejection:
 * // Promise.reject(new Error("Something async went wrong!"));
 * ```
 *
 * Notes:
 * - **IMPORT ORDER:** For maximum effectiveness, this module should be imported
 *   as the **very first line** of your application's entry point script. This
 *   ensures the error handlers are attached before any of your code runs or
 *   other modules are imported.
 * - **ENVIRONMENT VARIABLE:** Requires the `CRASH_REPORT_BASE_URL` environment
 *   variable to be set to the base URL of your crash report receiving server
 *   (e.g., `https://my-crash-server.com`). The reporter will send reports to
 *   `{CRASH_REPORT_BASE_URL}/api/report`. If this variable is not set, the
 *   crash reporter will not activate.
 * - **PERMISSIONS:** This module requires the following Deno permissions:
 *   - `--allow-env=CRASH_REPORT_BASE_URL`: To read the server URL.
 *   - `--allow-net={hostname}`: To send the report via `fetch` to the specified host.
 *     Replace `{hostname}` with the actual hostname from `CRASH_REPORT_BASE_URL`.
 *     Alternatively, `--allow-net` can be used, but is less secure.
 *   - `--allow-run=powershell,osascript,zenity`: To display native GUI confirmation
 *     dialogs on Windows, macOS, and Linux respectively. Grant permissions only for
 *     the commands relevant to the target platforms.
 * - **DEPENDENCIES:** On Linux, the `zenity` command-line tool must be installed
 *   for the GUI dialog to work. On Windows, PowerShell is expected. On macOS,
 *   `osascript` is used.
 * - **EXITING:** Upon capturing an error and completing (or attempting) the report
 *   process, the reporter will explicitly exit the Deno process using `Deno.exit(1)`.
 *   The `event.preventDefault()` calls attempt to stop Deno's default error logging.
 */
const CRASH_REPORT_BASE_URL = Deno.env.get("CRASH_REPORT_BASE_URL")
  ?.replace(/\/$/, "");
const CRASH_REPORT_ENDPOINT = CRASH_REPORT_BASE_URL
  ? `${CRASH_REPORT_BASE_URL}/api/report`
  : null; // Make it nullable if base url isn't set

const textDecoder = new TextDecoder(); // Reuse decoder

/**
 * Serializes a value for inclusion in the crash report, paying special
 * attention to Error objects to capture stack traces and messages.
 * @param value The value to serialize (e.g., event.error, event.reason)
 * @returns A representation suitable for JSON stringification.
 */
// deno-lint-ignore no-explicit-any
function serializeValueForReport(value: unknown): any {
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

async function crashReport(reportContentJsonString: string) {
  console.error("--- Crash Reporter Initializing ---");

  try {
    if (
      !reportContentJsonString || reportContentJsonString.trim() === "" ||
      reportContentJsonString.trim() === "{}"
    ) {
      console.error("--- Received empty or minimal report data. Exiting. ---");
      // Still exit with error code, as an error occurred to trigger this.
      Deno.exit(1);
      return;
    }

    // reportContentJsonString is already formatted JSON (from the event handler)
    console.error("\n--- Crash Report Details ---");
    console.error(reportContentJsonString); // Log the pre-formatted JSON
    console.error("---------------------------\n");

    // Show GUI confirmation dialog
    // Pass the JSON string; the dialog message is generic anyway.
    const confirmed = await showConfirmationDialog(reportContentJsonString);

    // Handle the response
    if (confirmed) {
      console.log("User accepted via GUI. Attempting to send report...");
      await sendReport(reportContentJsonString); // Send the JSON string
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
        const internalErrorMsg = JSON.stringify({
          type: "reporter_internal_error",
          error: serializeValueForReport(err),
          original_report_string: reportContentJsonString, // Include original data context
        });
        console.error("Attempting to send internal error report...");
        // Send directly without confirmation
        await sendReportInternal(internalErrorMsg);
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
 * @param _reportJsonString The full report JSON string (currently unused in dialog message)
 * @returns Promise<boolean> True if the user confirmed, false otherwise.
 */
async function showConfirmationDialog(
  _reportJsonString: string,
): Promise<boolean> {
  const title = "Crash Report";
  // Keep the message generic, as showing raw JSON isn't very user-friendly in a dialog.
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
 * @param contentJsonString The report content as a JSON string.
 */
async function sendReport(contentJsonString: string) {
  if (!CRASH_REPORT_ENDPOINT) {
    console.error("CRASH_REPORT_BASE_URL not set, cannot send report.");
    return;
  }
  await sendReportInternal(contentJsonString);
}

/**
 * Internal function to actually send the report via fetch.
 * Used by both normal reporting and internal error reporting.
 * @param contentJsonString The report content as a JSON string.
 */
async function sendReportInternal(contentJsonString: string) {
  if (!CRASH_REPORT_ENDPOINT) return; // Should not happen if called correctly, but safeguard

  console.log(`Sending report to: ${CRASH_REPORT_ENDPOINT}`);
  // deno-lint-ignore no-explicit-any
  let reportPayload: any;

  try {
    // Parse the incoming JSON string back into an object
    reportPayload = JSON.parse(contentJsonString);
  } catch (e) {
    console.error(
      "Internal Error: Failed to parse report content string before sending. Sending raw string.",
      e,
    );
    // Fallback: Send the raw string if parsing fails
    reportPayload = {
      type: "parse_failure",
      raw_report_string: contentJsonString,
    };
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
        // Embed the parsed report object (or fallback) here
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
