const CRASH_REPORT_BASE_URL = Deno.env.get("CRASH_REPORT_BASE_URL");
const CRASH_REPORT_ENDPOINT = `${CRASH_REPORT_BASE_URL}/api/report`;

async function crashReport(reportContent: string) {
  console.error("--- Crash Reporter GUI Initializing ---");

  try {
    if (reportContent.trim() === "") {
      console.error("--- Received no input. Exiting. ---");
      Deno.exit(0);
    }

    // 2. Display the received input in the console
    console.error("\n--- Crash Report Received (scroll up if needed) ---");
    console.error(reportContent);
    console.error("--------------------------------------------------\n");

    // 3. Show GUI confirmation dialog
    const confirmed = await showConfirmationDialog(reportContent);

    // 4. Handle the response
    if (confirmed) {
      console.log("User accepted via GUI. Attempting to send report...");
      await sendReport(reportContent);
    } else {
      console.log("User declined via GUI or dialog failed. Report not sent.");
    }
  } catch (err) {
    console.error("\nError in crash reporter:", err);
    // Optionally try to send the reporter's own error (without GUI confirmation)
    try {
      const internalErrorMsg =
        `Crash Reporter Internal Error:\n${err}\n\nOriginal Report Data:\n${reportContent}`;
      console.error("Attempting to send internal error report...");
      await sendReport(internalErrorMsg);
      console.error("Attempted to send internal error report.");
    } catch (sendErr) {
      console.error("Failed to send internal error report:", sendErr);
    }
    Deno.exit(1); // Exit with an error code
  }
}

/**
 * Shows a platform-specific GUI dialog asking for confirmation.
 * @param report The full report text (used for preview or context)
 * @returns Promise<boolean> True if the user confirmed, false otherwise.
 */
async function showConfirmationDialog(_report: string): Promise<boolean> {
  const title = "Crash Report";
  const message =
    `An application may have crashed or encountered an error.\n\n(Full details printed in the console window where you launched the app).\n\nDo you want to send an anonymous crash report?`;
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
          message.replace(/'/g, "''")
        }', '${
          title.replace(/'/g, "''")
        }', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning, [System.Windows.Forms.MessageBoxDefaultButton]::Button1);
                    Write-Host $result;
                `;
        command = new Deno.Command("powershell", {
          args: ["-NoProfile", "-Command", psCommand],
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        });
        // Use global TextDecoder
        successCondition = (output) =>
          new TextDecoder().decode(output.stdout).trim() === "Yes";
        break;
      }

      case "darwin": // macOS
      {
        console.log("Using osascript for dialog...");
        const appleScript = `display dialog "${
          message.replace(/"/g, '\\"')
        }" with title "${
          title.replace(/"/g, '\\"')
        }" buttons {"${cancelButton}", "${sendButton}"} default button "${sendButton}" with icon caution \n return button returned of result`;
        command = new Deno.Command("osascript", {
          args: ["-e", appleScript],
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        });
        // Use global TextDecoder
        successCondition = (output) =>
          new TextDecoder().decode(output.stdout).trim() === sendButton;
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
          ],
          stdin: "null",
          stdout: "null",
          stderr: "piped",
        });
        successCondition = (output) => output.success;
        break;
      }
      default: {
        console.warn(
          `Unsupported OS (${Deno.build.os}) for GUI dialog. Falling back to console prompt.`,
        );
        // Requires --allow-sys=prompt if this fallback is hit
        const answer = prompt("Send crash report? (yes/no):");
        return answer?.toLowerCase().trim().startsWith("y") ?? false;
      }
    }

    // Execute the command
    const output = await command.output(); // async have issues with catching signals

    if (successCondition(output)) {
      return true; // User confirmed
    } else {
      if (!output.success && !successCondition(output)) {
        // Use global TextDecoder
        const stderr = new TextDecoder().decode(output.stderr);
        if (stderr.trim()) {
          console.error(
            `Dialog command failed with code ${output.code}:\n${stderr}`,
          );
        } else {
          console.log("Dialog cancelled by user or failed without stderr.");
        }
      }
      return false; // User cancelled or command failed
    }
  } catch (err) {
    console.error("--------------------------------------------------");
    console.error("FATAL: Failed to execute GUI dialog command.");
    if (err instanceof Deno.errors.NotFound) {
      console.error(
        "=> The required dialog command (e.g., zenity, powershell, osascript) might not be installed or found in the system's PATH.",
      );
    } else {
      console.error("=> Error details:", err);
    }
    console.error("--------------------------------------------------");
    console.error("Please report the crash manually if desired.");
    return false; // Don't send if dialog failed
  }
}

/**
 * Sends the report to the configured endpoint.
 * @param content The report content string.
 */
async function sendReport(content: string) {
  console.log(`Sending report to: ${CRASH_REPORT_ENDPOINT}`);

  try {
    // Requires --allow-net=<hostname> or --allow-net
    const response = await fetch(CRASH_REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        report: content,
        reporterInfo: {
          os: Deno.build.os,
          arch: Deno.build.arch,
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
        console.error("Server response body:", errorBody);
      } catch (_) { /* Ignore error reading body */ }
    }
  } catch (error) {
    console.error("Network or fetch error:", error);
  }
}

// -------- Hook error events -----------
addEventListener("error", async (event) => {
  event.preventDefault();
  await crashReport(event.message);
  Deno.exit(1);
});
addEventListener("unhandledrejection", async (event) => {
  event.preventDefault();
  await crashReport(event.reason);
  Deno.exit(1);
});
