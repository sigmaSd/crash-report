import { crashReport } from "jsr:@sigmasd/crash-report";

if (import.meta.main) {
  crashReport({ a: 4 });
  // crashReport("hello");
}
