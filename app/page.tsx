// src/app/page.tsx
"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Loader2, ClipboardCopy, Github, Download } from "lucide-react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    console.log(message); // Console logging
    setLogs((prev) => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  const isValidGithubUrl = (url: string) => {
    const isValid = /^https:\/\/github\.com\/[\w-]+\/[\w-]+/.test(url);
    addLog(`URL validation: ${url} is ${isValid ? "valid" : "invalid"}`);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    addLog("Form submitted");

    if (!isValidGithubUrl(url)) {
      setError("Please enter a valid GitHub repository URL");
      addLog("Invalid URL provided");
      return;
    }

    setIsLoading(true);
    setError("");
    setProgress(0);
    setResult("");
    setStatus("Initializing...");
    setLogs([]);
    addLog("Starting repository analysis");

    try {
      addLog("Sending request to API");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      addLog(`API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        addLog(`API error: ${errorText}`);
        throw new Error(errorText);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      addLog("Starting stream processing");

      while (reader) {
        const { done, value } = await reader.read();
        if (done) {
          addLog("Stream complete");
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        addLog(`Received chunk of ${chunk.length} bytes`);
        buffer += chunk;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "") continue;

          try {
            const data = JSON.parse(line);
            addLog(`Processed message: ${JSON.stringify(data)}`);

            if (data.error) {
              throw new Error(data.error);
            }
            if (typeof data.progress === "number") {
              setProgress(data.progress);
            }
            if (data.status) {
              setStatus(data.status);
            }
            if (data.content) {
              addLog(`Received content of ${data.content.length} characters`);
              setResult((prev) => prev + data.content);
            }
          } catch (e) {
            addLog(`Error parsing message: ${e}`);
            console.error("Error parsing message:", line, e);
          }
        }
      }

      if (buffer) {
        addLog("Processing remaining buffer");
        try {
          const data = JSON.parse(buffer);
          if (data.content) {
            setResult((prev) => prev + data.content);
          }
        } catch (e) {
          addLog(`Error parsing final buffer: ${e}`);
          console.error("Error parsing final message:", buffer, e);
        }
      }

      setStatus("Analysis complete");
      addLog("Analysis completed successfully");
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An error occurred while analyzing the repository";
      setError(errorMessage);
      setStatus("Error occurred");
      addLog(`Error in analysis: ${errorMessage}`);
    } finally {
      setIsLoading(false);
      addLog("Process finished");
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Repository to txt</h1>
          <p className="text-gray-500">
            Enter a GitHub repository URL to generate a consolidated view of the
            codebase.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/username/repository"
                className="flex-1"
                disabled={isLoading}
              />
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Github className="w-4 h-4 mr-2" />
                )}
                Analyze
              </Button>
            </div>

            {isLoading && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm text-gray-500 text-center">
                  {status} ({progress}%)
                </p>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>

          {/* Debug Logs Section */}
          <div className="space-y-2">
            <h3 className="font-semibold">Debug Logs</h3>
            <pre className="bg-gray-100 p-4 rounded-lg text-xs overflow-auto max-h-[200px] text-gray-700">
              {logs.join("\n")}
            </pre>
          </div>

          {result && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Analysis Result</h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(result);
                      addLog("Copied result to clipboard");
                    }}
                  >
                    <ClipboardCopy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const blob = new Blob([result], { type: "text/plain" });
                      const downloadUrl = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = downloadUrl;
                      a.download = `${url.split("/").pop() || "repository"}-analysis.txt`;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(downloadUrl);
                      document.body.removeChild(a);
                      addLog("Downloaded result file");
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>
              <pre className="p-4 bg-gray-50 rounded-lg overflow-auto max-h-[600px] text-sm font-mono">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
