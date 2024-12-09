"use client";

import { useState, useCallback } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Loader2, ClipboardCopy, Github, Download, Upload } from "lucide-react";
import { EXCLUDED_FILES, EXCLUDED_DIRS, ALLOWED_EXTENSIONS } from "@/app/constants/files";

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const addLog = (message: string) => {
    console.log(message);
    setLogs((prev) => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  const isValidGithubUrl = (url: string) => {
    const isValid = /^https:\/\/github\.com\/[\w-]+\/[\w-]+/.test(url);
    addLog(`URL validation: ${url} is ${isValid ? "valid" : "invalid"}`);
    return isValid;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const processLocalRepository = async (items: DataTransferItemList) => {
    const files: { path: string; content: string }[] = [];
    const processEntry = async (entry: FileSystemEntry, path = "") => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        return new Promise<void>((resolve) => {
          fileEntry.file(async (file) => {
            const ext = "." + file.name.split(".").pop()?.toLowerCase();
            const allowedExts = ALLOWED_EXTENSIONS;

            if (
              !EXCLUDED_FILES.includes(file.name) &&
              (allowedExts?.includes(ext || "") || file.name === "README.md")
            ) {
              const content = await file.text();
              const fullPath = path ? `${path}/${file.name}` : file.name;
              files.push({ path: fullPath, content });

              setProgress((prev) => Math.min(90, prev + 2));
              setStatus(`Processing: ${fullPath}`);
              addLog(`Processed file: ${fullPath}`);
            }
            resolve();
          });
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const dirReader = dirEntry.createReader();

        const readEntries = (): Promise<FileSystemEntry[]> => {
          return new Promise((resolve) => {
            dirReader.readEntries((entries) => {
              resolve(entries);
            });
          });
        };

        const entries = await readEntries();
        const dirPath = path ? `${path}/${entry.name}` : entry.name;

        if (!EXCLUDED_DIRS.includes(entry.name)) {
          for (const childEntry of entries) {
            await processEntry(childEntry, dirPath);
          }
        }
      }
    };

    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) {
        await processEntry(entry);
      }
    }

    // Sort files and combine contents
    files.sort((a, b) => a.path.localeCompare(b.path));
    let result = "";
    for (const file of files) {
      result += `// Path: ${file.path}\n${file.content}\n\n`;
    }

    return result;
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    setIsLoading(true);
    setError("");
    setProgress(0);
    setResult("");
    setStatus("Processing local repository...");
    setLogs([]);

    try {
      addLog("Starting local repository processing");
      const items = e.dataTransfer.items;

      if (items) {
        const result = await processLocalRepository(items);
        setResult(result);
        setProgress(100);
        setStatus("Analysis complete!");
        addLog("Local repository processing completed");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An error occurred while processing the local repository";
      setError(errorMessage);
      setStatus("Error occurred");
      addLog(`Error in local processing: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    addLog("Starting repository conversion");

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
              setResult((prev) => prev + data.content);
            }
          } catch (e) {
            addLog(`Error parsing message: ${line}, ${e}`);
          }
        }
      }

      setStatus("Analysis complete");
      addLog("Conversion completed successfully");
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An error occurred while analyzing the repository";
      setError(errorMessage);
      setStatus("Error occurred");
      addLog(`Error in conversion: ${errorMessage}`);
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
            Drag and drop a local repository folder or enter a GitHub repository
            URL to generate a consolidated view of the codebase.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
          {/* Drag and Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-200 ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-gray-200 hover:border-primary/50"
            } ${isLoading ? "pointer-events-none opacity-50" : ""}`}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-lg font-medium">
              Drag and drop your repository folder here
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Or use the GitHub URL input below
            </p>
          </div>

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
                Convert to txt
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
                <h2 className="text-xl font-semibold">Conversion Result</h2>
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
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "repository-analysis.txt";
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
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
