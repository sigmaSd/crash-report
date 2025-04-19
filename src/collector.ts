/**
 * server.ts
 *
 * Deno HTTP server to receive crash reports via POST requests
 * and store them in Deno KV.
 */

// --- Configuration ---
const REPORT_PATH = "/api/report"; // The endpoint path clients should POST to

/**
 * Handles incoming HTTP requests.
 * @param req The incoming Request object.
 * @returns A Promise resolving to the Response object.
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const { method } = req;

  console.log(`Received request: ${method} ${pathname}`);

  // --- Routing and Method Check ---
  if (pathname !== REPORT_PATH) {
    console.log(`-> Responding 404 Not Found (path mismatch)`);
    return new Response("Not Found", { status: 404 });
  }

  if (method !== "POST") {
    console.log(`-> Responding 405 Method Not Allowed (method was ${method})`);
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "POST" }, // Indicate allowed method
    });
  }

  // --- Content Type Check ---
  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().includes("application/json")) {
    console.log(
      `-> Responding 415 Unsupported Media Type (Content-Type was ${contentType})`,
    );
    return new Response("Unsupported Media Type: Expected application/json", {
      status: 415,
    });
  }

  // --- Request Body Processing ---
  let reportData: unknown;
  try {
    reportData = await req.json();
    console.log("-> Successfully parsed JSON body.");
  } catch (err) {
    console.error("! Error parsing JSON body:", err);
    return new Response(`Bad Request: Invalid JSON - ${err}`, {
      status: 400,
    });
  }

  // --- Basic Payload Validation ---
  // Ensure it's an object and has the expected fields from the client script
  if (
    typeof reportData !== "object" ||
    reportData === null ||
    !("report" in reportData) ||
    !("timestamp" in reportData)
    // You could add more checks here, e.g., for reporterInfo
  ) {
    console.error("! Invalid report data structure received:", reportData);
    return new Response(
      "Bad Request: Payload missing required fields (e.g., timestamp, report)",
      { status: 400 },
    );
  }

  // --- Deno KV Interaction ---
  try {
    // Open the default Deno KV store.
    // For persistent storage across restarts, specify a path:
    // const kv = await Deno.openKv("/path/to/your/crash_reports.db");
    // Or ensure the DENO_KV_PATH environment variable is set when running.
    // If no path is specified, data might be lost when the server stops.
    console.log("-> Opening Deno KV store...");
    const kv = await Deno.openKv();
    console.log("-> Deno KV store opened.");

    // Generate a unique key for this report.
    // Using a UUID ensures uniqueness even if reports arrive simultaneously.
    const reportId = crypto.randomUUID();
    const key = ["reports", reportId]; // Store under a "reports" namespace

    console.log(`-> Storing report with ID: ${reportId}`);

    // Store the entire received JSON payload as the value.
    const commitResult = await kv.set(key, reportData);

    // kv.set returns an AtomicOperationResult, check if it was successful
    if (!commitResult.ok) {
      throw new Error(
        `KV commit failed for versionstamp: ${commitResult.versionstamp}`,
      );
    }

    kv.close(); // Close the KV connection when done with the request
    console.log(`-> Successfully stored report: ${reportId}`);

    // --- Success Response ---
    return new Response(
      JSON.stringify({ message: "Report received successfully", id: reportId }),
      {
        status: 201, // 201 Created is appropriate here
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("! Error interacting with Deno KV:", err);
    // Avoid leaking internal error details to the client
    return new Response("Internal Server Error: Failed to store report", {
      status: 500,
    });
  }
}

// Start the HTTP server
Deno.serve({
  port: 0,
  onListen: ({ hostname, port }) => {
    console.log(`Server listening on http://${hostname}:${port}`);
    // --- Server Startup ---
    console.log(`Crash Report Server starting...`);
    console.log(
      `Listening for POST requests on http://localhost:${port}${REPORT_PATH}`,
    );
    console.log(`Using Deno KV for storage.`);
    console.log(
      `  - To persist data, run with DENO_KV_PATH=./my_reports.kv or use Deno.openKv("./my_reports.kv")`,
    );
    console.log(
      `  - Required permissions: --allow-net --allow-read --allow-write (or --allow-env=DENO_KV_PATH)`,
    );
  },
}, handler);
